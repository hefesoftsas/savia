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
    lifecycle::{Source, MAX_CAPTURE_DURATION},
    segments::{SegmentAssembler, SegmentWorker},
    spool::CaptureSpool,
};

const SAMPLE_RATE: u32 = 48_000;

struct CaptureBuffer {
    started: Instant,
    error: Option<String>,
    segmenter: Option<Arc<Mutex<SegmentAssembler>>>,
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
    segments: Option<SegmentWorker>,
}

impl SystemCapture {
    pub fn start(
        _temp_dir: &std::path::Path,
        spool: Arc<Mutex<CaptureSpool>>,
        origin: Instant,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let buffer = Arc::new(Mutex::new(CaptureBuffer {
            started: Instant::now(),
            error: None,
            segmenter: None,
        }));
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let thread_stop = Arc::clone(&stop);
        let thread_buffer = Arc::clone(&buffer);
        let thread_spool = spool;
        let thread_origin = origin;
        let worker = thread::Builder::new()
            .name("savia-wasapi-loopback".into())
            .spawn(move || {
                loopback_worker(
                    thread_stop,
                    thread_buffer,
                    thread_spool,
                    thread_origin,
                    started_tx,
                )
            })
            .map_err(|_| "Could not start the Windows system audio worker.".to_string())?;

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
                Err("Windows did not initialize system audio capture in time.".into())
            }
        }
    }

    pub fn stop(mut self) -> Result<(), String> {
        self.request_stop();
        if let Some(worker) = self.worker.take() {
            worker
                .join()
                .map_err(|_| "The Windows system audio worker stopped unexpectedly.".to_string())?;
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

impl Drop for SystemCapture {
    fn drop(&mut self) {
        self.request_stop();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        if let Some(segments) = self.segments.take() {
            let _ = segments.finish();
        }
    }
}

fn loopback_worker(
    stop: Arc<AtomicBool>,
    buffer: Arc<Mutex<CaptureBuffer>>,
    spool: Arc<Mutex<CaptureSpool>>,
    origin: Instant,
    started: mpsc::SyncSender<Result<SegmentWorker, String>>,
) {
    use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

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
        let segments = SegmentWorker::start(
            Source::System,
            SAMPLE_RATE,
            origin.elapsed().as_secs_f64(),
            spool,
        )?;
        if let Ok(mut target) = buffer.lock() {
            target.segmenter = Some(segments.assembler());
        }
        client
            .start_stream()
            .map_err(|error| format!("Could not start Windows loopback capture: {error}"))?;
        let _ = started.send(Ok(segments));

        while !stop.load(Ordering::Acquire) {
            match capture.get_next_packet_size() {
                Ok(Some(_frames)) => {
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
        Ok(()) => {}
        Err(error) => {
            let _ = started.send(Err(error.clone()));
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
    if buffer.started.elapsed() >= MAX_CAPTURE_DURATION {
        return;
    }
    let Some(segmenter) = buffer.segmenter.as_ref().cloned() else {
        return;
    };
    let Ok(mut segmenter) = segmenter.lock() else {
        return;
    };
    for frame in input.chunks_exact(8) {
        let left = f32::from_le_bytes(frame[0..4].try_into().unwrap());
        let right = f32::from_le_bytes(frame[4..8].try_into().unwrap());
        let value = (((left + right) * 0.5).clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        segmenter.push_i16(value);
    }
}
