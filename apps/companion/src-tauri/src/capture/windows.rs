use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use super::{
    audio::RawAudio,
    lifecycle::{MAX_CAPTURE_DURATION, MAX_PCM_BYTES},
};

const SAMPLE_RATE: u32 = 48_000;

struct CaptureBuffer {
    pcm: Vec<u8>,
    started: Instant,
    error: Option<String>,
}

struct ComApartment;

impl Drop for ComApartment {
    fn drop(&mut self) {
        wasapi::deinitialize();
    }
}

pub struct SystemCapture {
    stop: Arc<AtomicBool>,
    buffer: Arc<Mutex<CaptureBuffer>>,
    worker: Option<JoinHandle<()>>,
}

impl SystemCapture {
    pub fn start(_temp_dir: &std::path::Path) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let buffer = Arc::new(Mutex::new(CaptureBuffer {
            pcm: Vec::with_capacity(MAX_PCM_BYTES),
            started: Instant::now(),
            error: None,
        }));
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let thread_stop = Arc::clone(&stop);
        let thread_buffer = Arc::clone(&buffer);
        let worker = thread::Builder::new()
            .name("savia-wasapi-loopback".into())
            .spawn(move || loopback_worker(thread_stop, thread_buffer, started_tx))
            .map_err(|_| "Could not start the Windows system audio worker.".to_string())?;

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
                Err("Windows did not initialize system audio capture in time.".into())
            }
        }
    }

    pub fn stop(mut self) -> Result<RawAudio, String> {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            worker
                .join()
                .map_err(|_| "The Windows system audio worker stopped unexpectedly.".to_string())?;
        }
        let buffer = self
            .buffer
            .lock()
            .map_err(|_| "The Windows system audio buffer is unavailable.".to_string())?;
        if let Some(error) = &buffer.error {
            return Err(error.clone());
        }
        Ok(RawAudio {
            pcm: buffer.pcm.clone(),
            sample_rate: SAMPLE_RATE,
            error: None,
        })
    }
}

impl Drop for SystemCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn loopback_worker(
    stop: Arc<AtomicBool>,
    buffer: Arc<Mutex<CaptureBuffer>>,
    started: mpsc::SyncSender<Result<(), String>>,
) {
    use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

    let mut notified = false;
    let result = (|| -> Result<(), String> {
        initialize_mta()
            .ok()
            .map_err(|error| format!("Windows audio initialization failed: {error}"))?;
        let _apartment = ComApartment;
        let enumerator = DeviceEnumerator::new()
            .map_err(|error| format!("Could not list Windows audio devices: {error}"))?;
        let device = enumerator
            .get_default_device(&Direction::Render)
            .map_err(|error| format!("No Windows system output device is available: {error}"))?;
        let mut client = device
            .get_iaudioclient()
            .map_err(|error| format!("Could not open Windows system output: {error}"))?;
        let format = WaveFormat::new(32, 32, &SampleType::Float, SAMPLE_RATE as usize, 2, None);
        let mode = StreamMode::PollingShared {
            autoconvert: true,
            buffer_duration_hns: 100_000,
        };
        client
            .initialize_client(&format, &Direction::Capture, &mode)
            .map_err(|error| {
                format!("Could not initialize Windows system audio capture: {error}")
            })?;
        let capture = client
            .get_audiocaptureclient()
            .map_err(|error| format!("Could not open Windows loopback stream: {error}"))?;
        client
            .start_stream()
            .map_err(|error| format!("Could not start Windows loopback capture: {error}"))?;
        let _ = started.send(Ok(()));
        notified = true;

        while !stop.load(Ordering::Acquire) {
            match capture.get_next_packet_size() {
                Ok(Some(frames)) if frames > 0 => {
                    let mut raw = VecDeque::new();
                    if let Err(error) = capture.read_from_device_to_deque(&mut raw) {
                        set_worker_error(
                            &buffer,
                            format!("Windows system audio capture failed: {error}"),
                        );
                        break;
                    }
                    let bytes: Vec<u8> = raw.into_iter().collect();
                    append_float_stereo(&buffer, &bytes);
                }
                Ok(_) => thread::sleep(Duration::from_millis(5)),
                Err(error) => {
                    set_worker_error(
                        &buffer,
                        format!("Windows system output became unavailable: {error}"),
                    );
                    break;
                }
            }
            let expired = buffer
                .lock()
                .map(|buffer| buffer.started.elapsed() >= MAX_CAPTURE_DURATION)
                .unwrap_or(true);
            if expired {
                break;
            }
        }
        let stop_result = client.stop_stream().map_err(|error| {
            format!("Could not stop Windows system audio capture cleanly: {error}")
        });
        stop_result?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            if !notified {
                let _ = started.send(Ok(()));
            }
        }
        Err(error) => {
            if !notified {
                let _ = started.send(Err(error.clone()));
            }
            set_worker_error(&buffer, error);
        }
    }
}

fn set_worker_error(buffer: &Arc<Mutex<CaptureBuffer>>, error: String) {
    if let Ok(mut buffer) = buffer.lock() {
        buffer.error = Some(error);
    }
}

fn append_float_stereo(buffer: &Arc<Mutex<CaptureBuffer>>, input: &[u8]) {
    let Ok(mut buffer) = buffer.lock() else {
        return;
    };
    if buffer.started.elapsed() >= MAX_CAPTURE_DURATION
        || buffer.pcm.len() / 2 >= SAMPLE_RATE as usize * MAX_CAPTURE_DURATION.as_secs() as usize
    {
        return;
    }
    for frame in input.chunks_exact(8) {
        if buffer.pcm.len() / 2 >= SAMPLE_RATE as usize * MAX_CAPTURE_DURATION.as_secs() as usize {
            break;
        }
        if buffer.pcm.len() + 2 > MAX_PCM_BYTES {
            buffer.error = Some("Capture reached the 8 MiB per-track limit.".into());
            break;
        }
        let left = f32::from_le_bytes(frame[0..4].try_into().unwrap());
        let right = f32::from_le_bytes(frame[4..8].try_into().unwrap());
        let value = (((left + right) * 0.5).clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        buffer.pcm.extend_from_slice(&value.to_le_bytes());
    }
}
