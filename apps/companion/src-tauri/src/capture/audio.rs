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

use super::lifecycle::{MAX_CAPTURE_DURATION, MAX_PCM_BYTES, MAX_WAV_BYTES};

#[derive(Clone, Debug)]
pub struct RawAudio {
    pub pcm: Vec<u8>,
    pub sample_rate: u32,
    pub error: Option<String>,
}

struct Buffer {
    pcm: Vec<u8>,
    started: Instant,
    sample_rate: u32,
    error: Option<String>,
}

pub struct MicrophoneCapture {
    stop: Arc<AtomicBool>,
    buffer: Arc<Mutex<Buffer>>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for MicrophoneCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl MicrophoneCapture {
    pub fn start() -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let buffer = Arc::new(Mutex::new(Buffer {
            pcm: Vec::with_capacity(MAX_PCM_BYTES),
            started: Instant::now(),
            sample_rate: 0,
            error: None,
        }));
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let worker_stop = Arc::clone(&stop);
        let worker_buffer = Arc::clone(&buffer);
        let worker = thread::Builder::new()
            .name("savia-microphone-capture".into())
            .spawn(move || microphone_worker(worker_stop, worker_buffer, started_tx))
            .map_err(|_| "Could not start the microphone audio worker.".to_string())?;
        match started_rx.recv_timeout(Duration::from_secs(8)) {
            Ok(Ok(())) => Ok(Self {
                stop,
                buffer,
                worker: Some(worker),
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

    pub fn stop(mut self) -> RawAudio {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        let buffer = self.buffer.lock().expect("audio buffer lock");
        RawAudio {
            pcm: buffer.pcm.clone(),
            sample_rate: buffer.sample_rate,
            error: buffer.error.clone(),
        }
    }
}

fn microphone_worker(
    stop: Arc<AtomicBool>,
    buffer: Arc<Mutex<Buffer>>,
    started: mpsc::SyncSender<Result<(), String>>,
) {
    let result = start_microphone_stream(&buffer);
    let stream = match result {
        Ok(stream) => {
            let _ = started.send(Ok(()));
            stream
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

fn start_microphone_stream(buffer: &Arc<Mutex<Buffer>>) -> Result<cpal::Stream, String> {
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
    target.sample_rate = sample_rate;
    target.started = Instant::now();
    drop(target);
    stream
        .play()
        .map_err(|_| "Could not start the microphone input stream.".to_string())?;
    Ok(stream)
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
    let Ok(mut buffer) = target.lock() else {
        return;
    };
    if buffer.started.elapsed() >= MAX_CAPTURE_DURATION
        || buffer.pcm.len() / 2
            >= buffer.sample_rate as usize * MAX_CAPTURE_DURATION.as_secs() as usize
    {
        return;
    }
    if buffer.pcm.len() >= MAX_PCM_BYTES {
        buffer.error = Some("Capture reached the 8 MiB per-track limit.".into());
        return;
    }

    for frame in samples.chunks_exact(channels) {
        if buffer.pcm.len() / 2
            >= buffer.sample_rate as usize * MAX_CAPTURE_DURATION.as_secs() as usize
        {
            break;
        }
        if buffer.pcm.len() + 2 > MAX_PCM_BYTES {
            buffer.error = Some("Capture reached the 8 MiB per-track limit.".into());
            break;
        }
        let mono = frame.iter().map(|sample| sample.as_float()).sum::<f32>() / channels as f32;
        let pcm = (mono.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        buffer.pcm.extend_from_slice(&pcm.to_le_bytes());
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
    fn callback_straddling_sixty_seconds_stops_cleanly_at_exact_frame_cap() {
        let sample_rate = 8_000;
        let mut pcm = vec![0; sample_rate as usize * 60 * 2 - 2];
        let target = Arc::new(Mutex::new(Buffer {
            pcm: std::mem::take(&mut pcm),
            started: Instant::now(),
            sample_rate,
            error: None,
        }));

        append_samples(&[0.1f32, 0.2], 1, &target);

        let buffer = target.lock().unwrap();
        assert_eq!(buffer.pcm.len(), sample_rate as usize * 60 * 2);
        assert!(buffer.error.is_none());
    }

    #[test]
    fn callback_crossing_pcm_byte_cap_sets_an_error() {
        let target = Arc::new(Mutex::new(Buffer {
            pcm: vec![0; MAX_PCM_BYTES - 2],
            started: Instant::now(),
            sample_rate: 96_000,
            error: None,
        }));

        append_samples(&[0.1f32, 0.2], 1, &target);

        let buffer = target.lock().unwrap();
        assert_eq!(buffer.pcm.len(), MAX_PCM_BYTES);
        assert!(buffer
            .error
            .as_deref()
            .is_some_and(|error| error.contains("8 MiB")));
    }

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
                pcm: Vec::new(),
                started: Instant::now(),
                sample_rate: 0,
                error: None,
            })),
            worker: Some(worker),
        };

        drop(capture);

        assert!(finished.load(Ordering::Acquire));
    }
}
