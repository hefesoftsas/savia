use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    SampleFormat,
};

use super::{
    lifecycle::{Source, MAX_CAPTURE_DURATION, MAX_PCM_BYTES, MAX_WAV_BYTES},
    segments::{SegmentAssembler, SegmentWorker},
    spool::CaptureSpool,
};

#[derive(Clone, Debug)]
pub struct RawAudio {
    pub pcm: Vec<u8>,
    pub sample_rate: u32,
    pub error: Option<String>,
}

struct Buffer {
    started: Instant,
    error: Option<String>,
    segmenter: Option<Arc<Mutex<SegmentAssembler>>>,
}

pub struct MicrophoneCapture {
    stop: Arc<AtomicBool>,
    buffer: Arc<Mutex<Buffer>>,
    worker: Option<JoinHandle<()>>,
    segments: Option<SegmentWorker>,
}

impl Drop for MicrophoneCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        if let Some(segments) = self.segments.take() {
            let _ = segments.finish();
        }
    }
}

impl MicrophoneCapture {
    pub fn start(spool: Arc<Mutex<CaptureSpool>>, origin: Instant) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let buffer = Arc::new(Mutex::new(Buffer {
            started: Instant::now(),
            error: None,
            segmenter: None,
        }));
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let worker_stop = Arc::clone(&stop);
        let worker_buffer = Arc::clone(&buffer);
        let worker = thread::Builder::new()
            .name("savia-microphone-capture".into())
            .spawn(move || microphone_worker(worker_stop, worker_buffer, spool, origin, started_tx))
            .map_err(|_| "Could not start the microphone audio worker.".to_string())?;
        match started_rx.recv_timeout(Duration::from_secs(8)) {
            Ok(Ok(segments)) => Ok(Self {
                stop,
                buffer,
                worker: Some(worker),
                segments: Some(segments),
            }),
            Ok(Err(error)) => {
                let _ = worker.join();
                Err(error)
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                let _ = worker.join();
                Err("The microphone did not initialize in time.".into())
            }
        }
    }

    pub fn stop(mut self) -> Result<(), String> {
        self.request_stop();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        let capture_error = self
            .buffer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .error
            .clone();
        let result = self
            .segments
            .take()
            .map(SegmentWorker::finish)
            .unwrap_or(Ok(()));
        if let Some(error) = capture_error {
            return Err(error);
        }
        result
    }

    pub fn request_stop(&self) {
        self.stop.store(true, Ordering::Release);
    }
}

fn microphone_worker(
    stop: Arc<AtomicBool>,
    buffer: Arc<Mutex<Buffer>>,
    spool: Arc<Mutex<CaptureSpool>>,
    origin: Instant,
    started: mpsc::SyncSender<Result<SegmentWorker, String>>,
) {
    let result = start_microphone_stream(&buffer, spool, origin);
    let stream = match result {
        Ok(pair) => {
            // Transfer the worker handle to the command thread for an orderly flush.
            let _ = started.send(Ok(pair.1));
            pair.0
        }
        Err(error) => {
            let _ = started.send(Err(error.clone()));
            set_error(&buffer, error);
            return;
        }
    };
    while !stop.load(Ordering::Acquire) {
        let expired = buffer
            .lock()
            .map(|buffer| buffer.started.elapsed() >= MAX_CAPTURE_DURATION)
            .unwrap_or(true);
        if expired {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    drop(stream);
}

fn start_microphone_stream(
    buffer: &Arc<Mutex<Buffer>>,
    spool: Arc<Mutex<CaptureSpool>>,
    origin: Instant,
) -> Result<(cpal::Stream, SegmentWorker), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No microphone input device is available.".to_string())?;
    let config = device
        .default_input_config()
        .map_err(|_| "Could not read the microphone format.".to_string())?;
    let sample_rate = config.sample_rate().0;
    if !(8_000..=96_000).contains(&sample_rate) {
        return Err("The microphone sample rate is outside the supported 8–96 kHz range.".into());
    }
    let channels = config.channels() as usize;
    let samples = Arc::clone(&buffer);
    let errors = Arc::clone(&buffer);
    let segments = SegmentWorker::start(
        Source::Microphone,
        sample_rate,
        origin.elapsed().as_secs_f64(),
        spool,
    )?;
    let segmenter = segments.assembler();
    if let Ok(mut target) = buffer.lock() {
        target.segmenter = Some(segmenter);
    }
    let stream_config = config.config();
    let stream = match config.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _| append_samples(data, channels, &samples),
            move |error| set_error(&errors, format!("Microphone capture failed: {error}")),
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _| append_samples(data, channels, &samples),
            move |error| set_error(&errors, format!("Microphone capture failed: {error}")),
            None,
        ),
        SampleFormat::U16 => device.build_input_stream(
            &stream_config,
            move |data: &[u16], _| append_samples(data, channels, &samples),
            move |error| set_error(&errors, format!("Microphone capture failed: {error}")),
            None,
        ),
        _ => return Err("The microphone uses an unsupported sample format.".into()),
    }
    .map_err(|_| "Could not open the microphone input stream.".to_string())?;
    let mut target = buffer
        .lock()
        .map_err(|_| "The microphone audio buffer is unavailable.".to_string())?;
    target.started = Instant::now();
    drop(target);
    stream
        .play()
        .map_err(|_| "Could not start the microphone input stream.".to_string())?;
    Ok((stream, segments))
}

fn set_error(buffer: &Arc<Mutex<Buffer>>, error: String) {
    if let Ok(mut buffer) = buffer.lock() {
        buffer.error = Some(error);
    }
}

trait AudioSample: Copy {
    fn as_float(self) -> f32;
}

impl AudioSample for f32 {
    fn as_float(self) -> f32 {
        self
    }
}
impl AudioSample for i16 {
    fn as_float(self) -> f32 {
        self as f32 / 32768.0
    }
}
impl AudioSample for u16 {
    fn as_float(self) -> f32 {
        (self as f32 - 32768.0) / 32768.0
    }
}

fn append_samples<T: AudioSample>(samples: &[T], channels: usize, target: &Arc<Mutex<Buffer>>) {
    if channels == 0 {
        return;
    }
    let Ok(buffer) = target.lock() else {
        return;
    };
    if buffer.started.elapsed() >= MAX_CAPTURE_DURATION {
        return;
    }
    let Some(segmenter) = buffer.segmenter.as_ref().cloned() else {
        return;
    };
    let Ok(mut segmenter) = segmenter.lock() else {
        return;
    };
    for frame in samples.chunks_exact(channels) {
        let mono = frame.iter().map(|sample| sample.as_float()).sum::<f32>() / channels as f32;
        let pcm = (mono.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        segmenter.push_i16(pcm);
    }
}

pub fn wav(pcm: &[u8], sample_rate: u32) -> Result<Vec<u8>, String> {
    if pcm.len() > MAX_PCM_BYTES || pcm.len() % 2 != 0 || sample_rate == 0 {
        return Err("Captured audio is invalid or exceeds its size limit.".into());
    }
    let mut wav = Vec::with_capacity(MAX_WAV_BYTES.min(44 + pcm.len()));
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&((36 + pcm.len()) as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(pcm);
    Ok(wav)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn dropping_microphone_capture_stops_and_joins_its_worker() {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let finished = Arc::new(AtomicBool::new(false));
        let worker_finished = Arc::clone(&finished);
        let worker = thread::spawn(move || {
            while !worker_stop.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(1));
            }
            worker_finished.store(true, Ordering::Release);
        });
        let capture = MicrophoneCapture {
            stop,
            buffer: Arc::new(Mutex::new(Buffer {
                started: Instant::now(),
                error: None,
                segmenter: None,
            })),
            worker: Some(worker),
            segments: None,
        };

        drop(capture);

        assert!(finished.load(Ordering::Acquire));
    }
}
