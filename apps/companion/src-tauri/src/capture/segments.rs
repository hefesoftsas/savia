//! Bounded, continuously processed PCM segments for an open capture device.
use std::{
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
};

use super::{
    audio::RawAudio,
    codec::encode_ogg_opus,
    lifecycle::{Source, MAX_PCM_BYTES},
    spool::{CaptureSpool, ChunkInfo, NOMINAL_SEGMENT_SECONDS},
};

const QUEUE_SEGMENTS: usize = 2;

struct RawSegment {
    start_seconds: f64,
    duration_seconds: f64,
    audio: RawAudio,
}

pub struct SegmentAssembler {
    sender: Option<mpsc::SyncSender<RawSegment>>,
    sample_rate: u32,
    source_offset: f64,
    frames: u64,
    segment_start_frame: u64,
    pcm: Vec<u8>,
    error: Arc<Mutex<Option<String>>>,
}

pub struct SegmentWorker {
    assembler: Arc<Mutex<SegmentAssembler>>,
    error: Arc<Mutex<Option<String>>>,
    worker: Option<JoinHandle<()>>,
}

impl SegmentWorker {
    pub fn start(
        source: Source,
        sample_rate: u32,
        source_offset: f64,
        spool: Arc<Mutex<CaptureSpool>>,
    ) -> Result<Self, String> {
        if !(8_000..=96_000).contains(&sample_rate) {
            return Err("Capture sample rate is outside the supported 8–96 kHz range.".into());
        }
        let (sender, receiver) = mpsc::sync_channel::<RawSegment>(QUEUE_SEGMENTS);
        let error = Arc::new(Mutex::new(None));
        let worker_error = Arc::clone(&error);
        let worker = thread::Builder::new()
            .name(format!("savia-{:?}-segment-encoder", source).to_lowercase())
            .spawn(move || {
                while let Ok(segment) = receiver.recv() {
                    let audio = match encode_ogg_opus(segment.audio) {
                        Ok(audio) => audio,
                        Err(error) => {
                            set_error(&worker_error, error);
                            continue;
                        }
                    };
                    if (audio.duration_seconds - segment.duration_seconds).abs() > 0.001 {
                        set_error(&worker_error, "Encoded segment duration differs from captured audio by more than 1 ms.".into());
                        continue;
                    }
                    let mut spool = spool
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    let sequence = spool.chunks_for(source).len() as u16;
                    let info = ChunkInfo {
                        source,
                        sequence,
                        start_seconds: segment.start_seconds,
                        duration_seconds: audio.duration_seconds,
                        bytes: audio.ogg.len(),
                        sample_rate: audio.sample_rate,
                    };
                    if let Err(error) = spool.append_chunk(info, &audio.ogg) {
                        set_error(&worker_error, error);
                    }
                }
            })
            .map_err(|_| "Could not start the audio segment encoder.".to_string())?;
        let assembler = Arc::new(Mutex::new(SegmentAssembler {
            sender: Some(sender),
            sample_rate,
            source_offset,
            frames: 0,
            segment_start_frame: 0,
            pcm: Vec::with_capacity(
                (sample_rate as usize * NOMINAL_SEGMENT_SECONDS as usize * 2).min(MAX_PCM_BYTES),
            ),
            error: Arc::clone(&error),
        }));
        Ok(Self {
            assembler,
            error,
            worker: Some(worker),
        })
    }

    pub fn assembler(&self) -> Arc<Mutex<SegmentAssembler>> {
        Arc::clone(&self.assembler)
    }

    pub fn finish(mut self) -> Result<(), String> {
        let flush_result = {
            let mut assembler = self
                .assembler
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let result = assembler.flush(true);
            assembler.sender.take();
            result
        };
        let join_result = self
            .worker
            .take()
            .map(|worker| {
                worker
                    .join()
                    .map_err(|_| "The audio segment encoder stopped unexpectedly.".to_string())
            })
            .unwrap_or(Ok(()));
        flush_result?;
        join_result?;
        self.error
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .map_or(Ok(()), Err)
    }
}

impl SegmentAssembler {
    pub fn push_external_segment(
        &mut self,
        start_seconds: f64,
        mut pcm: Vec<u8>,
    ) -> Result<(), String> {
        if pcm.is_empty()
            || pcm.len() > MAX_PCM_BYTES
            || pcm.len() % 2 != 0
            || !(8_000..=96_000).contains(&self.sample_rate)
            || !start_seconds.is_finite()
            || start_seconds < 0.0
        {
            return Err("External audio segment is invalid or oversized.".into());
        }
        let start_seconds = self.source_offset + start_seconds;
        if start_seconds >= 3_600.0 {
            return Ok(());
        }
        let remaining_frames =
            ((3_600.0 - start_seconds) * f64::from(self.sample_rate)).floor() as usize;
        pcm.truncate(pcm.len().min(remaining_frames * 2));
        if pcm.is_empty() {
            return Ok(());
        }
        let duration_seconds = pcm.len() as f64 / 2.0 / f64::from(self.sample_rate);
        if duration_seconds > 60.001 {
            return Err("Audio segment exceeds the 60 second limit.".into());
        }
        let segment = RawSegment {
            start_seconds,
            duration_seconds,
            audio: RawAudio {
                pcm,
                sample_rate: self.sample_rate,
                error: None,
            },
        };
        let Some(sender) = self.sender.as_ref() else {
            return Err("Capture segment sink is closed.".into());
        };
        if sender.try_send(segment).is_err() {
            set_error(
                &self.error,
                "The audio encoder could not keep up; a capture gap was recorded.".into(),
            );
        }
        self.frames =
            ((start_seconds + duration_seconds) * f64::from(self.sample_rate)).round() as u64;
        self.segment_start_frame = self.frames;
        Ok(())
    }

    pub fn push_i16(&mut self, sample: i16) {
        if self.sender.is_none() {
            return;
        }
        let sample_rate = u64::from(self.sample_rate);
        let max_frames =
            ((3_600.0 - self.source_offset).max(0.0) * sample_rate as f64).floor() as u64;
        if self.frames >= max_frames {
            return;
        }
        if self.pcm.len() + 2 > MAX_PCM_BYTES {
            set_error(
                &self.error,
                "Capture reached the 8 MiB per-segment PCM limit.".into(),
            );
            self.frames += 1;
            return;
        }
        self.pcm.extend_from_slice(&sample.to_le_bytes());
        self.frames += 1;
        if self.frames - self.segment_start_frame >= sample_rate * NOMINAL_SEGMENT_SECONDS as u64 {
            let _ = self.flush(false);
        }
    }

    fn flush(&mut self, blocking: bool) -> Result<(), String> {
        if self.pcm.is_empty() {
            return Ok(());
        }
        let start_seconds =
            self.source_offset + self.segment_start_frame as f64 / f64::from(self.sample_rate);
        let duration_seconds = self.pcm.len() as f64 / 2.0 / f64::from(self.sample_rate);
        let raw = RawSegment {
            start_seconds,
            duration_seconds,
            audio: RawAudio {
                pcm: std::mem::take(&mut self.pcm),
                sample_rate: self.sample_rate,
                error: None,
            },
        };
        self.pcm = Vec::with_capacity(
            (self.sample_rate as usize * NOMINAL_SEGMENT_SECONDS as usize * 2).min(MAX_PCM_BYTES),
        );
        self.segment_start_frame = self.frames;
        let Some(sender) = self.sender.as_ref() else {
            return Err("Capture segment sink is closed.".into());
        };
        if blocking {
            sender
                .send(raw)
                .map_err(|_| "Could not queue the final audio segment.".to_string())
        } else if sender.try_send(raw).is_err() {
            set_error(
                &self.error,
                "The audio encoder could not keep up; a capture gap was recorded.".into(),
            );
            Ok(())
        } else {
            Ok(())
        }
    }
}

fn set_error(target: &Arc<Mutex<Option<String>>>, error: String) {
    let mut target = target
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if target.is_none() {
        *target = Some(error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn assembler(rate: u32) -> (SegmentAssembler, mpsc::Receiver<RawSegment>) {
        let (sender, receiver) = mpsc::sync_channel(QUEUE_SEGMENTS);
        (
            SegmentAssembler {
                sender: Some(sender),
                sample_rate: rate,
                source_offset: 0.0,
                frames: 0,
                segment_start_frame: 0,
                pcm: Vec::with_capacity(rate as usize * NOMINAL_SEGMENT_SECONDS as usize * 2),
                error: Arc::new(Mutex::new(None)),
            },
            receiver,
        )
    }

    #[test]
    fn rolls_segments_without_resetting_the_timeline_or_growing_raw_buffers() {
        let (mut writer, receiver) = assembler(8_000);
        for _ in 0..8_000 * 30 + 8_000 * 7 {
            writer.push_i16(7);
        }
        writer.flush(true).unwrap();
        let first = receiver.recv().unwrap();
        let second = receiver.recv().unwrap();
        assert_eq!(first.start_seconds, 0.0);
        assert!((first.duration_seconds - 30.0).abs() < 0.001);
        assert!((second.start_seconds - 30.0).abs() < 0.001);
        assert!((second.duration_seconds - 7.0).abs() < 0.001);
        assert!(first.audio.pcm.len() <= MAX_PCM_BYTES);
        assert!(second.audio.pcm.len() <= MAX_PCM_BYTES);
    }

    #[test]
    fn bounded_worker_queue_reports_a_gap_when_encoding_falls_behind() {
        let (mut writer, receiver) = assembler(8_000);
        for _ in 0..8_000 * 30 * 3 {
            writer.push_i16(1);
        }
        assert!(writer
            .error
            .lock()
            .unwrap()
            .as_deref()
            .is_some_and(|error| error.contains("gap")));
        assert!(receiver.try_recv().is_ok());
        assert!(writer.pcm.len() <= MAX_PCM_BYTES);
    }

    #[test]
    fn synthetic_one_hour_stays_in_120_bounded_segments_and_has_no_segment_121() {
        let (mut writer, receiver) = assembler(8_000);
        for sequence in 0..120u16 {
            for _ in 0..8_000 * 30 {
                writer.push_i16(3);
            }
            assert!(writer.pcm.len() <= MAX_PCM_BYTES);
            let segment = receiver
                .recv()
                .expect("each 30 second boundary should flush");
            assert!((segment.start_seconds - f64::from(sequence) * 30.0).abs() < 0.001);
            assert!((segment.duration_seconds - 30.0).abs() < 0.001);
            assert!(segment.audio.pcm.len() <= MAX_PCM_BYTES);
            assert!(segment.start_seconds + segment.duration_seconds <= 3_600.001);
        }
        writer.push_i16(3);
        writer.flush(true).unwrap();
        assert!(receiver.try_recv().is_err());
    }
}
