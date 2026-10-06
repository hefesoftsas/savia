pub mod backend;
pub mod capture;
mod capture_error;

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Instant,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use capture::{
    audio::MicrophoneCapture,
    lifecycle::{Lifecycle, Source, Sources, State, TrackInfo, MAX_CAPTURE_DURATION},
    spool::{CaptureSpool, ChunkInfo, DraftState},
    SystemCapture,
};
use capture_error::{classify_capture_error, CaptureErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, RunEvent, State as TauriState};
use tempfile::TempDir;

type SharedCapture = Arc<Mutex<CaptureSession>>;

#[derive(Clone, Default)]
struct ExitCleanup(Arc<Mutex<ExitCleanupState>>);

#[derive(Default)]
struct ExitCleanupState {
    running: bool,
    completed: bool,
    close_requested: bool,
    exit_code: Option<i32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CleanupRequest {
    Start,
    Waiting,
    Continue,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CleanupCompletion {
    CloseWindow,
    Exit(i32),
    None,
}

impl ExitCleanup {
    fn request_close(&self) -> CleanupRequest {
        let mut state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.completed {
            return CleanupRequest::Continue;
        }
        state.close_requested = true;
        if state.running {
            CleanupRequest::Waiting
        } else {
            state.running = true;
            CleanupRequest::Start
        }
    }

    fn request_exit(&self, code: i32) -> CleanupRequest {
        let mut state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.completed {
            return CleanupRequest::Continue;
        }
        state.exit_code = Some(code);
        if state.running {
            CleanupRequest::Waiting
        } else {
            state.running = true;
            CleanupRequest::Start
        }
    }

    fn finish(&self) -> CleanupCompletion {
        let mut state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.running = false;
        state.completed = true;
        if let Some(code) = state.exit_code {
            CleanupCompletion::Exit(code)
        } else if state.close_requested {
            CleanupCompletion::CloseWindow
        } else {
            CleanupCompletion::None
        }
    }
}

fn finish_exit_cleanup(app: AppHandle, capture: SharedCapture, cleanup: ExitCleanup) {
    thread::spawn(move || {
        capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .stop();
        match cleanup.finish() {
            CleanupCompletion::Exit(code) => app.exit(code),
            CleanupCompletion::CloseWindow => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.close();
                } else {
                    app.exit(0);
                }
            }
            CleanupCompletion::None => {}
        }
    });
}

#[derive(Default)]
struct CaptureSession {
    lifecycle: Lifecycle,
    microphone: Option<MicrophoneCapture>,
    system: Option<SystemCapture>,
    temp_dir: Option<TempDir>,
    spool: Option<Arc<Mutex<CaptureSpool>>>,
    spool_root: Option<PathBuf>,
    recovered: bool,
    storage_error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSources {
    pub microphone: bool,
    pub system: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    state: &'static str,
    elapsed_seconds: f64,
    tracks: Vec<TrackInfo>,
    error: Option<String>,
    error_code: Option<CaptureErrorCode>,
    session_id: Option<String>,
    chunks: Vec<ChunkInfo>,
    recovered: bool,
    interrupted: bool,
}

impl CaptureSession {
    fn status(&self) -> CaptureStatus {
        let state = match self.lifecycle.state {
            State::Idle => "idle",
            State::Recording => "recording",
            State::Paused => "paused",
            State::Ready => "ready",
            State::Error => "error",
        };
        let spool = self.spool.as_ref().map(|spool| {
            spool
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
        });
        let interrupted = spool
            .as_ref()
            .is_some_and(|spool| spool.state() == DraftState::Interrupted);
        let mut tracks = self.lifecycle.tracks.clone();
        tracks.clear();
        if let Some(spool) = spool.as_ref() {
            for source in [Source::Microphone, Source::System] {
                let chunks = spool.chunks_for(source);
                if let Some(first) = chunks.first() {
                    tracks.push(TrackInfo {
                        source,
                        duration_seconds: chunks.iter().map(|chunk| chunk.duration_seconds).sum(),
                        sample_rate: first.sample_rate,
                        bytes: chunks.iter().map(|chunk| chunk.bytes).sum(),
                    });
                }
            }
        }
        let elapsed = self.lifecycle.elapsed_at(Instant::now());
        let error = self
            .storage_error
            .clone()
            .or_else(|| self.lifecycle.error.clone());
        CaptureStatus {
            state: if interrupted { "interrupted" } else { state },
            elapsed_seconds: elapsed.as_secs_f64(),
            tracks,
            error_code: error.as_deref().map(classify_capture_error),
            error,
            session_id: spool.as_ref().map(|spool| spool.session_id().to_string()),
            chunks: spool
                .map(|spool| spool.chunks().to_vec())
                .unwrap_or_default(),
            recovered: self.recovered,
            interrupted,
        }
    }

    fn stop(&mut self) {
        if self.lifecycle.state != State::Recording && self.lifecycle.state != State::Paused {
            return;
        }
        if let Some(microphone) = self.microphone.as_ref() {
            microphone.request_stop();
        }
        #[cfg(target_os = "macos")]
        let system_stop_error = self
            .system
            .as_mut()
            .and_then(|system| system.request_stop().err());
        #[cfg(target_os = "windows")]
        let system_stop_error = {
            if let Some(system) = self.system.as_ref() {
                system.request_stop();
            }
            None
        };
        let now = Instant::now();
        let microphone = self
            .microphone
            .take()
            .map(MicrophoneCapture::stop)
            .transpose();
        let system = self.system.take().map(SystemCapture::stop).transpose();
        self.temp_dir.take();
        if let Some(error) = system_stop_error {
            self.fail_stop(error);
            return;
        }
        if let Err(error) = microphone.and(system).map(|_| ()) {
            self.fail_stop(error);
            return;
        }
        self.lifecycle.stop(now);
        if let Some(spool) = self.spool.as_mut() {
            let mut spool = spool
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if spool.chunks().is_empty() {
                drop(spool);
                self.fail_stop(
                    "No audio segments were captured. Check the selected input and try again."
                        .into(),
                );
                return;
            }
            let last_chunk_end = spool
                .chunks()
                .iter()
                .map(|chunk| chunk.start_seconds + chunk.duration_seconds)
                .fold(0.0f64, f64::max);
            let elapsed = self
                .lifecycle
                .elapsed
                .as_secs_f64()
                .max(last_chunk_end)
                .min(3_600.0);
            self.lifecycle.elapsed = std::time::Duration::from_secs_f64(elapsed);
            let result = spool.stop(elapsed, false);
            drop(spool);
            if let Err(error) = result {
                self.fail_stop(error);
                return;
            }
        }
    }

    fn pause(&mut self) -> Result<(), String> {
        if self.lifecycle.state != State::Recording {
            return Err("There is no active recording to pause.".into());
        }
        if let Some(microphone) = self.microphone.as_ref() {
            microphone.request_stop();
        }
        #[cfg(target_os = "macos")]
        let system_stop_error = self
            .system
            .as_mut()
            .and_then(|system| system.request_stop().err());
        // Explicit annotation: the unit-only Windows request_stop leaves
        // `None` without an inferable payload type (E0282).
        #[cfg(target_os = "windows")]
        let system_stop_error: Option<String> = {
            if let Some(system) = self.system.as_ref() {
                system.request_stop();
            }
            None
        };
        let now = Instant::now();
        let microphone = self
            .microphone
            .take()
            .map(MicrophoneCapture::stop)
            .transpose();
        let system = self.system.take().map(SystemCapture::stop).transpose();
        self.temp_dir.take();
        if let Some(error) = system_stop_error {
            self.fail_stop(error.clone());
            return Err(error);
        }
        if let Err(error) = microphone.and(system).map(|_| ()) {
            self.fail_stop(error.clone());
            return Err(error);
        }
        // Freeze the clock and keep the spool open so resume can append.
        let elapsed = self.lifecycle.elapsed_at(now);
        self.lifecycle.pause(now);
        let elapsed_secs = elapsed.as_secs_f64().min(3_600.0);
        let spool_result = if let Some(spool) = self.spool.as_ref() {
            spool
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .update_elapsed(elapsed_secs)
        } else {
            Ok(())
        };
        if let Err(error) = spool_result {
            self.fail_stop(error.clone());
            return Err(error);
        }
        Ok(())
    }

    fn fail_stop(&mut self, error: String) {
        let elapsed = self.lifecycle.elapsed_at(Instant::now()).as_secs_f64();
        if let Some(spool) = self.spool.as_mut() {
            let _ = spool
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .stop(elapsed, true);
        }
        self.temp_dir.take();
        self.lifecycle.fail(error);
    }

    fn discard(&mut self) -> Result<(), String> {
        if self.lifecycle.state == State::Recording || self.lifecycle.state == State::Paused {
            self.stop();
        }
        self.microphone.take();
        self.system.take();
        self.temp_dir.take();
        let delete_result = if let Some(spool) = self.spool.as_ref() {
            spool
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .discard()
        } else if let Some(root) = self.spool_root.as_ref() {
            capture::spool::discard_root(root)
        } else {
            Ok(())
        };
        if let Err(error) = delete_result {
            self.storage_error = Some(error.clone());
            self.lifecycle.fail(error.clone());
            return Err(error);
        }
        self.spool = None;
        self.recovered = false;
        self.storage_error = None;
        self.lifecycle.discard();
        Ok(())
    }
}

#[tauri::command]
fn open_savia(origin: String) -> Result<(), String> {
    backend::open_savia(&origin)
}

#[tauri::command]
async fn capture_status(capture: TauriState<'_, SharedCapture>) -> Result<CaptureStatus, String> {
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .status()
    })
    .await
    .map_err(|_| "Could not read capture status.".to_string())
}

#[tauri::command]
async fn start_capture(
    app: AppHandle,
    capture: TauriState<'_, SharedCapture>,
    session_id: String,
    sources: StartSources,
) -> Result<CaptureStatus, String> {
    let sources = Sources {
        microphone: sources.microphone,
        system: sources.system,
    };
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        start_capture_blocking(capture, sources, session_id, app)
    })
    .await
    .map_err(|_| "Could not start audio capture.".to_string())
}

fn start_capture_blocking(
    capture: SharedCapture,
    sources: Sources,
    session_id: String,
    app: AppHandle,
) -> CaptureStatus {
    let mut session = capture
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if session.spool.is_some() {
        let hint = if session.lifecycle.state == State::Paused {
            "The recording is paused. Resume or discard it before starting another recording."
        } else {
            "A saved capture draft must be discarded before starting another recording."
        };
        session.lifecycle.fail(hint.into());
        return session.status();
    }
    if let Some(error) = session.storage_error.clone() {
        session.lifecycle.fail(error);
        return session.status();
    }
    if let Err(error) = session.lifecycle.start(sources, Instant::now()) {
        if !sources.any() {
            session.lifecycle.fail(error);
        }
        return session.status();
    }
    let root = match session.spool_root.clone().or_else(|| {
        app.path()
            .app_data_dir()
            .ok()
            .map(|path| path.join("capture-spool"))
    }) {
        Some(root) => root,
        None => {
            session
                .lifecycle
                .fail("Could not prepare private capture storage.".into());
            return session.status();
        }
    };
    let source_list = [Source::Microphone, Source::System]
        .into_iter()
        .filter(|source| sources.includes(*source))
        .collect();
    let spool = match CaptureSpool::create(root.clone(), session_id, source_list) {
        Ok(spool) => Arc::new(Mutex::new(spool)),
        Err(error) => {
            session.lifecycle.fail(error);
            return session.status();
        }
    };
    session.spool_root = Some(root);
    session.spool = Some(spool);
    session.recovered = false;
    session.temp_dir.take();

    let temp_dir = match tempfile::Builder::new()
        .prefix("savia-companion-")
        .tempdir()
    {
        Ok(temp_dir) => temp_dir,
        Err(_) => {
            let _ = session.discard();
            session
                .lifecycle
                .fail("Could not prepare temporary audio storage.".into());
            return session.status();
        }
    };
    if sources.microphone {
        if let Err(error) = capture::authorize_microphone(temp_dir.path()) {
            let _ = session.discard();
            session.lifecycle.fail(error);
            return session.status();
        }
    }
    let generation = Instant::now();
    session.lifecycle.reanchor_start(generation);
    session.temp_dir = Some(temp_dir);
    if sources.system {
        let started = match session.temp_dir.as_ref() {
            Some(temp_dir) => SystemCapture::start(
                temp_dir.path(),
                Arc::clone(session.spool.as_ref().unwrap()),
                generation,
            ),
            None => Err("Could not prepare temporary audio storage.".into()),
        };
        match started {
            Ok(system) => session.system = Some(system),
            Err(error) => {
                let _ = session.discard();
                session.lifecycle.fail(error);
                return session.status();
            }
        }
    }
    if sources.microphone {
        match MicrophoneCapture::start(Arc::clone(session.spool.as_ref().unwrap()), generation) {
            Ok(microphone) => session.microphone = Some(microphone),
            Err(error) => {
                let _ = session.discard();
                session.lifecycle.fail(error);
                return session.status();
            }
        }
    }
    drop(session);

    spawn_elapsed_watcher(capture.clone(), generation);
    capture
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .status()
}

fn spawn_elapsed_watcher(capture: SharedCapture, generation: Instant) {
    thread::spawn(move || loop {
        thread::sleep(std::time::Duration::from_secs(1));
        let mut session = capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !session.lifecycle.is_recording_generation(generation) {
            return;
        }
        let elapsed = session.lifecycle.elapsed_at(Instant::now());
        if let Some(spool) = session.spool.as_ref() {
            let _ = spool
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .update_elapsed(elapsed.as_secs_f64());
        }
        if elapsed >= MAX_CAPTURE_DURATION {
            session.stop();
            return;
        }
    });
}

fn resume_capture_blocking(capture: SharedCapture) -> Result<CaptureStatus, String> {
    let requested_at = Instant::now();
    let mut session = capture
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if session.lifecycle.state != State::Paused {
        return Err("There is no paused recording to resume.".into());
    }
    let spool = session
        .spool
        .as_ref()
        .ok_or_else(|| "The paused recording has no saved audio.".to_string())?
        .clone();
    let sources = session.lifecycle.sources;
    if !sources.any() {
        return Err("The paused recording has no capture sources.".into());
    }
    // Continue the timeline where prior audio ended so chunks stay ordered
    // and non-overlapping; paused wall-clock time is excluded.
    let spool_elapsed = spool
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .elapsed_seconds();
    let resume_offset = spool_elapsed
        .max(session.lifecycle.elapsed.as_secs_f64())
        .min(3_600.0);
    // Allocate fallible resources before changing lifecycle state so a
    // failure keeps the session paused instead of reporting a recording
    // that captures nothing.
    let temp_dir = tempfile::Builder::new()
        .prefix("savia-companion-")
        .tempdir()
        .map_err(|_| "Could not prepare temporary audio storage.".to_string())?;
    if sources.microphone {
        if let Err(error) = capture::authorize_microphone(temp_dir.path()) {
            return Err(error);
        }
    }
    session.lifecycle.elapsed = std::time::Duration::from_secs_f64(resume_offset);
    session.lifecycle.resume(requested_at)?;
    session.temp_dir.take();
    let generation = Instant::now();
    session.lifecycle.reanchor_start(generation);
    session.temp_dir = Some(temp_dir);
    // Shift the device clock origin back by the recorded offset so new
    // segments continue the timeline instead of restarting at zero.
    let origin = generation
        .checked_sub(std::time::Duration::from_secs_f64(resume_offset))
        .unwrap_or(generation);
    if sources.system {
        let started = match session.temp_dir.as_ref() {
            Some(temp_dir) => SystemCapture::start(temp_dir.path(), Arc::clone(&spool), origin),
            None => Err("Could not prepare temporary audio storage.".into()),
        };
        match started {
            Ok(system) => session.system = Some(system),
            Err(error) => {
                session.temp_dir.take();
                session.lifecycle.pause(generation);
                session.lifecycle.elapsed = std::time::Duration::from_secs_f64(resume_offset);
                return Err(error);
            }
        }
    }
    if sources.microphone {
        match MicrophoneCapture::start(Arc::clone(&spool), origin) {
            Ok(microphone) => session.microphone = Some(microphone),
            Err(error) => {
                session.temp_dir.take();
                session.microphone.take();
                session.system.take();
                session.lifecycle.pause(generation);
                session.lifecycle.elapsed = std::time::Duration::from_secs_f64(resume_offset);
                return Err(error);
            }
        }
    }
    drop(session);
    spawn_elapsed_watcher(capture.clone(), generation);
    Ok(capture
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .status())
}

#[tauri::command]
async fn pause_capture(capture: TauriState<'_, SharedCapture>) -> Result<CaptureStatus, String> {
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        session.pause()?;
        Ok(session.status())
    })
    .await
    .map_err(|_| "Could not pause audio capture.".to_string())?
}

#[tauri::command]
async fn resume_capture(capture: TauriState<'_, SharedCapture>) -> Result<CaptureStatus, String> {
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || resume_capture_blocking(capture))
        .await
        .map_err(|_| "Could not resume audio capture.".to_string())?
}

#[tauri::command]
async fn stop_capture(capture: TauriState<'_, SharedCapture>) -> Result<CaptureStatus, String> {
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut capture = capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        capture.stop();
        capture.status()
    })
    .await
    .map_err(|_| "Could not stop audio capture.".to_string())
}

#[tauri::command]
async fn discard_capture(capture: TauriState<'_, SharedCapture>) -> Result<CaptureStatus, String> {
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut capture = capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        capture.discard()?;
        Ok(capture.status())
    })
    .await
    .map_err(|_| "Could not discard audio capture.".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadCapture {
    base64: String,
    format: &'static str,
    duration_seconds: f64,
}

#[tauri::command]
async fn read_capture(
    capture: TauriState<'_, SharedCapture>,
    source: Source,
) -> Result<ReadCapture, String> {
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let capture = capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let spool = capture
            .spool
            .as_ref()
            .ok_or_else(|| "No saved capture is available.".to_string())?;
        let spool = spool
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if capture.lifecycle.state == State::Recording || capture.lifecycle.state == State::Paused {
            return Err("Captured audio is available only after recording has stopped.".into());
        }
        let chunks = spool.chunks_for(source);
        if chunks.is_empty() {
            return Err("No captured audio is available for that source.".into());
        }
        if chunks.len() != 1 {
            return Err(
                "This recording contains multiple segments; read each segment individually.".into(),
            );
        }
        let audio = spool.read_chunk(source, chunks[0].sequence)?;
        Ok(ReadCapture {
            base64: STANDARD.encode(audio),
            format: "ogg",
            duration_seconds: chunks[0].duration_seconds,
        })
    })
    .await
    .map_err(|_| "Could not read captured audio.".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadCaptureChunk {
    base64: String,
    format: &'static str,
    duration_seconds: f64,
}

#[tauri::command]
async fn read_capture_chunk(
    capture: TauriState<'_, SharedCapture>,
    source: Source,
    sequence: u16,
) -> Result<ReadCaptureChunk, String> {
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let capture = capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let spool = capture
            .spool
            .as_ref()
            .ok_or_else(|| "No saved capture is available.".to_string())?;
        let spool = spool
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let info = spool
            .chunks()
            .iter()
            .find(|chunk| chunk.source == source && chunk.sequence == sequence)
            .ok_or_else(|| "Captured segment is unavailable.".to_string())?;
        let bytes = spool.read_chunk(source, sequence)?;
        Ok(ReadCaptureChunk {
            base64: STANDARD.encode(bytes),
            format: "ogg",
            duration_seconds: info.duration_seconds,
        })
    })
    .await
    .map_err(|_| "Could not read captured segment.".to_string())?
}

#[derive(Serialize)]
pub struct ApiError {
    message: String,
}

#[tauri::command]
async fn companion_request(
    origin: String,
    token: String,
    operation: backend::Operation,
    body: Option<Value>,
) -> Result<Value, ApiError> {
    backend::request(backend::CompanionRequest {
        origin,
        token,
        operation,
        body,
    })
    .await
    .map_err(|message| ApiError { message })
}

pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(CaptureSession::default())))
        .manage(ExitCleanup::default())
        .setup(|app| {
            let root = app.path().app_data_dir()?.join("capture-spool");
            std::fs::create_dir_all(&root)?;
            let capture = app.state::<SharedCapture>();
            let mut capture = capture
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            capture.spool_root = Some(root);
            match CaptureSpool::load(capture.spool_root.as_ref().unwrap()) {
                Ok(Some(spool)) => {
                    capture.lifecycle.state = State::Ready;
                    capture.lifecycle.elapsed =
                        std::time::Duration::from_secs_f64(spool.elapsed_seconds());
                    capture.recovered = spool.recovered();
                    capture.spool = Some(Arc::new(Mutex::new(spool)));
                }
                Ok(None) => {}
                Err(error) => {
                    capture.storage_error = Some(error.clone());
                    capture.lifecycle.fail(error);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_status,
            start_capture,
            pause_capture,
            resume_capture,
            stop_capture,
            discard_capture,
            read_capture,
            read_capture_chunk,
            open_savia,
            companion_request,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Savia Companion")
        .run(|app, event| match event {
            RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                let cleanup = app.state::<ExitCleanup>().inner().clone();
                match cleanup.request_close() {
                    CleanupRequest::Continue => {}
                    CleanupRequest::Waiting => api.prevent_close(),
                    CleanupRequest::Start => {
                        api.prevent_close();
                        let capture = app.state::<SharedCapture>().inner().clone();
                        finish_exit_cleanup(app.clone(), capture, cleanup);
                    }
                }
            }
            RunEvent::ExitRequested { code, api, .. } => {
                let cleanup = app.state::<ExitCleanup>().inner().clone();
                match cleanup.request_exit(code.unwrap_or(0)) {
                    CleanupRequest::Continue => {}
                    CleanupRequest::Waiting => api.prevent_exit(),
                    CleanupRequest::Start => {
                        api.prevent_exit();
                        let capture = app.state::<SharedCapture>().inner().clone();
                        finish_exit_cleanup(app.clone(), capture, cleanup);
                    }
                }
            }
            RunEvent::Exit => {}
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_close_and_quit_requests_share_one_cleanup() {
        let cleanup = ExitCleanup::default();

        assert_eq!(cleanup.request_close(), CleanupRequest::Start);
        assert_eq!(cleanup.request_close(), CleanupRequest::Waiting);
        assert_eq!(cleanup.request_exit(0), CleanupRequest::Waiting);
        assert_eq!(cleanup.request_close(), CleanupRequest::Waiting);
        assert_eq!(cleanup.finish(), CleanupCompletion::Exit(0));
        assert_eq!(cleanup.request_close(), CleanupRequest::Continue);
        assert_eq!(cleanup.request_exit(0), CleanupRequest::Continue);
    }

    #[test]
    fn a_close_finishes_by_closing_the_window_only_after_discard() {
        let cleanup = ExitCleanup::default();

        assert_eq!(cleanup.request_close(), CleanupRequest::Start);
        assert_eq!(cleanup.finish(), CleanupCompletion::CloseWindow);
        assert_eq!(cleanup.request_close(), CleanupRequest::Continue);
    }
}
