pub mod backend;
pub mod capture;
mod capture_error;
mod credential;
mod diagnostics;
mod preferences;

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::Instant,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use capture::{
    audio::MicrophoneCapture,
    library::{LocalMeeting, MeetingLibrary},
    lifecycle::{Lifecycle, Source, Sources, State, TrackInfo, MAX_CAPTURE_DURATION},
    spool::{CaptureSpool, ChunkInfo, DraftState},
    startup::start_available_sources,
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
    library_root: Option<PathBuf>,
    source_warnings: Vec<SourceWarning>,
    recovered: bool,
    storage_error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSources {
    pub microphone: bool,
    pub system: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWarning {
    source: Source,
    error_code: CaptureErrorCode,
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
    active_sources: Vec<Source>,
    source_warnings: Vec<SourceWarning>,
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
            active_sources: [Source::Microphone, Source::System]
                .into_iter()
                .filter(|source| self.lifecycle.sources.includes(*source))
                .collect(),
            source_warnings: self.source_warnings.clone(),
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
        let meeting_id = self.spool.as_ref().map(|spool| {
            spool
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .session_id()
                .to_string()
        });
        let delete_result = if let (Some(root), Some(id)) = (&self.library_root, meeting_id) {
            MeetingLibrary::open(root.clone()).and_then(|library| library.remove(&id))
        } else if let Some(spool) = self.spool.as_ref() {
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
        self.spool_root = None;
        self.source_warnings.clear();
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
    name: Option<String>,
) -> Result<CaptureStatus, String> {
    let _legacy_sources = (sources.microphone, sources.system);
    let sources = Sources {
        microphone: true,
        system: true,
    };
    let capture = capture.inner().clone();
    let selected = match (sources.microphone, sources.system) {
        (true, true) => "microphone_and_system",
        (true, false) => "microphone",
        (false, true) => "system",
        _ => "none",
    };
    diagnostics::record("capture.start", "requested", Some(selected), None, None);
    let started = Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || {
        diagnostics::record("capture.start", "worker_started", None, None, None);
        start_capture_blocking(capture, sources, session_id, name, app)
    })
    .await;
    match result {
        Ok(status) => {
            diagnostics::record(
                "capture.start",
                "completed",
                Some(status.state),
                None,
                Some(started.elapsed().as_millis() as u64),
            );
            Ok(status)
        }
        Err(_) => {
            diagnostics::record(
                "capture.start",
                "worker_failed",
                None,
                None,
                Some(started.elapsed().as_millis() as u64),
            );
            Err("Could not start audio capture.".into())
        }
    }
}

fn start_capture_blocking(
    capture: SharedCapture,
    sources: Sources,
    session_id: String,
    name: Option<String>,
    app: AppHandle,
) -> CaptureStatus {
    let mut session = capture
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if matches!(session.lifecycle.state, State::Recording | State::Paused) {
        let mut status = session.status();
        status.error = Some("Finish the current meeting before starting another recording.".into());
        status.error_code = Some(CaptureErrorCode::PendingDraft);
        return status;
    }
    // Detach a completed selection; its files stay in the meeting library.
    session.spool = None;
    session.spool_root = None;
    session.storage_error = None;
    session.source_warnings.clear();
    session.recovered = false;
    session.lifecycle.discard();
    let root = match session.library_root.clone().or_else(|| {
        app.path()
            .app_data_dir()
            .ok()
            .map(|p| p.join("capture-spool"))
    }) {
        Some(root) => root,
        None => {
            session
                .lifecycle
                .fail("Could not prepare private meeting storage.".into());
            return session.status();
        }
    };
    let library = match MeetingLibrary::open(root.clone()) {
        Ok(library) => library,
        Err(error) => {
            session.lifecycle.fail(error);
            return session.status();
        }
    };
    session.library_root = Some(root);
    let name = name.unwrap_or_else(|| "Meeting".into());
    if let Err(error) = library.initialize(&session_id, &name) {
        session.lifecycle.fail(error);
        return session.status();
    }
    let meeting_path = match library.meeting_path(&session_id) {
        Ok(path) => path,
        Err(error) => {
            session.lifecycle.fail(error);
            return session.status();
        }
    };
    let spool = match CaptureSpool::create(
        meeting_path.clone(),
        session_id.clone(),
        vec![Source::Microphone, Source::System],
    ) {
        Ok(spool) => Arc::new(Mutex::new(spool)),
        Err(error) => {
            let _ = library.remove(&session_id);
            session.lifecycle.fail(error);
            return session.status();
        }
    };
    session.spool_root = Some(meeting_path);
    session.spool = Some(spool);
    let generation = Instant::now();
    if let Err(error) = session.lifecycle.start(sources, generation) {
        let _ = session.discard();
        session.lifecycle.fail(error);
        return session.status();
    }
    let temp_dir = match tempfile::Builder::new()
        .prefix("savia-companion-")
        .tempdir()
    {
        Ok(dir) => dir,
        Err(_) => {
            let _ = session.discard();
            session
                .lifecycle
                .fail("Could not prepare temporary audio storage.".into());
            return session.status();
        }
    };
    let temp_path = temp_dir.path().to_path_buf();
    session.temp_dir = Some(temp_dir);
    let generation = match start_session_sources(
        &mut session,
        &temp_path,
        std::time::Duration::ZERO,
    ) {
        Ok(generation) => generation,
        Err(error) => {
            let _ = session.discard();
            session.lifecycle.fail(error);
            return session.status();
        }
    };
    session.lifecycle.reanchor_start(generation);
    drop(session);
    spawn_elapsed_watcher(capture.clone(), generation);
    capture
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .status()
}

fn start_session_sources(
    session: &mut CaptureSession,
    temp_dir: &Path,
    offset: std::time::Duration,
) -> Result<Instant, String> {
    let microphone_dir = temp_dir.join("microphone");
    let system_dir = temp_dir.join("system");
    std::fs::create_dir_all(&microphone_dir)
        .and_then(|_| std::fs::create_dir_all(&system_dir))
        .map_err(|_| "Could not prepare temporary audio storage.".to_string())?;
    let spool = session
        .spool
        .as_ref()
        .ok_or("The meeting has no capture storage.")?
        .clone();
    let microphone_authorization = capture::authorize_microphone(&microphone_dir);
    let generation = Instant::now();
    let origin = generation.checked_sub(offset).unwrap_or(generation);
    let (mut mic_attempt, mut system_attempt) = (0, 0);
    let result = start_available_sources(
        || {
            mic_attempt += 1;
            diagnostics::record(
                "capture.source",
                "attempt",
                Some("microphone"),
                Some(mic_attempt),
                None,
            );
            if let Err(error) = &microphone_authorization {
                return Err(error.clone());
            }
            MicrophoneCapture::start(spool.clone(), origin)
        },
        || {
            system_attempt += 1;
            diagnostics::record(
                "capture.source",
                "attempt",
                Some("system"),
                Some(system_attempt),
                None,
            );
            SystemCapture::start(&system_dir, spool.clone(), origin)
        },
        || thread::sleep(std::time::Duration::from_millis(200)),
    );
    session.source_warnings.clear();
    if let Some(error) = result.microphone_error {
        session.source_warnings.push(SourceWarning {
            source: Source::Microphone,
            error_code: classify_capture_error(&error),
        });
    }
    if let Some(error) = result.system_error {
        session.source_warnings.push(SourceWarning {
            source: Source::System,
            error_code: classify_capture_error(&error),
        });
    }
    session.lifecycle.sources = Sources {
        microphone: result.microphone.is_some(),
        system: result.system.is_some(),
    };
    session.microphone = result.microphone;
    session.system = result.system;
    if !session.lifecycle.sources.any() {
        diagnostics::record("capture.source", "all_failed", None, Some(3), None);
        return Err("Neither microphone nor system audio could start after three attempts.".into());
    }
    diagnostics::record(
        "capture.source",
        "ready",
        Some(
            if session.lifecycle.sources.microphone && session.lifecycle.sources.system {
                "both"
            } else if session.lifecycle.sources.microphone {
                "microphone_only"
            } else {
                "system_only"
            },
        ),
        None,
        None,
    );
    Ok(generation)
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
    let mut session = capture
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if session.lifecycle.state != State::Paused {
        return Err("There is no paused recording to resume.".into());
    }
    let spool = session
        .spool
        .as_ref()
        .ok_or("The paused meeting has no saved audio.")?
        .clone();
    let offset = spool
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .elapsed_seconds()
        .max(session.lifecycle.elapsed.as_secs_f64())
        .min(3_600.0);
    let temp_dir = tempfile::Builder::new()
        .prefix("savia-companion-")
        .tempdir()
        .map_err(|_| "Could not prepare temporary audio storage.".to_string())?;
    let elapsed = std::time::Duration::from_secs_f64(offset);
    let path = temp_dir.path().to_path_buf();
    session.temp_dir = Some(temp_dir);
    let generation = match start_session_sources(&mut session, &path, elapsed) {
        Ok(generation) => generation,
        Err(error) => {
            session.temp_dir.take();
            return Err(error);
        }
    };
    session.lifecycle.elapsed = elapsed;
    session.lifecycle.resume(generation)?;
    session.lifecycle.reanchor_start(generation);
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

fn meeting_library(app: &AppHandle) -> Result<MeetingLibrary, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not locate meeting storage.".to_string())?
        .join("capture-spool");
    MeetingLibrary::open(root)
}

#[tauri::command]
async fn meeting_list(app: AppHandle) -> Result<Vec<LocalMeeting>, String> {
    tauri::async_runtime::spawn_blocking(move || meeting_library(&app)?.list())
        .await
        .map_err(|_| "Could not read local meetings.".to_string())?
}

fn restore_selected_meeting(session: &mut CaptureSession, spool: CaptureSpool) {
    let elapsed = spool.elapsed_seconds();
    let sources = spool
        .chunks()
        .iter()
        .map(|chunk| chunk.source)
        .collect::<Vec<_>>();
    session.microphone.take();
    session.system.take();
    session.temp_dir.take();
    session.lifecycle = Lifecycle::default();
    session.lifecycle.state = State::Ready;
    session.lifecycle.elapsed = std::time::Duration::from_secs_f64(elapsed);
    session.lifecycle.sources = Sources {
        microphone: sources.contains(&Source::Microphone),
        system: sources.contains(&Source::System),
    };
    session.spool_root = Some(spool.root().to_path_buf());
    session.recovered = spool.recovered();
    session.storage_error = None;
    session.source_warnings.clear();
    session.spool = Some(Arc::new(Mutex::new(spool)));
}

#[tauri::command]
async fn meeting_select(
    app: AppHandle,
    capture: TauriState<'_, SharedCapture>,
    session_id: String,
) -> Result<CaptureStatus, String> {
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if matches!(session.lifecycle.state, State::Recording | State::Paused) {
            return Err("Finish the current meeting before selecting another.".into());
        }
        let path = meeting_library(&app)?.meeting_path(&session_id)?;
        let spool = CaptureSpool::load(path)?.ok_or("The selected meeting is unavailable.")?;
        restore_selected_meeting(&mut session, spool);
        Ok(session.status())
    })
    .await
    .map_err(|_| "Could not select the meeting.".to_string())?
}

#[tauri::command]
async fn meeting_rename(app: AppHandle, session_id: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || meeting_library(&app)?.rename(&session_id, &name))
        .await
        .map_err(|_| "Could not rename the meeting.".to_string())?
}

#[tauri::command]
async fn meeting_mark_uploaded(
    app: AppHandle,
    session_id: String,
    origin: String,
) -> Result<(), String> {
    let origin = backend::validate_origin(&origin)?
        .origin()
        .ascii_serialization();
    tauri::async_runtime::spawn_blocking(move || {
        meeting_library(&app)?.mark_uploaded(&session_id, &origin)
    })
    .await
    .map_err(|_| "Could not save the upload status.".to_string())?
}

#[tauri::command]
async fn meeting_remove(
    app: AppHandle,
    capture: TauriState<'_, SharedCapture>,
    session_id: String,
) -> Result<CaptureStatus, String> {
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let selected = session.spool.as_ref().is_some_and(|spool| {
            spool
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .session_id()
                == session_id
        });
        if selected && matches!(session.lifecycle.state, State::Recording | State::Paused) {
            return Err("Finish the current meeting before deleting it.".into());
        }
        meeting_library(&app)?.remove(&session_id)?;
        if selected {
            session.spool = None;
            session.spool_root = None;
            session.storage_error = None;
            session.source_warnings.clear();
            session.recovered = false;
            session.lifecycle.discard();
        }
        Ok(session.status())
    })
    .await
    .map_err(|_| "Could not remove the meeting.".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewChunkPcm {
    base64_pcm: String,
    sample_rate: u32,
}

#[tauri::command]
async fn read_preview_chunk(
    app: AppHandle,
    session_id: String,
    source: Source,
    sequence: u16,
) -> Result<PreviewChunkPcm, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = meeting_library(&app)?.meeting_path(&session_id)?;
        let spool = CaptureSpool::load_read_only(path)?.ok_or("The meeting is unavailable.")?;
        if spool.state() == DraftState::Recording {
            return Err("Finish the meeting before previewing it.".into());
        }
        let ogg = spool.read_chunk(source, sequence)?;
        let pcm = capture::codec::decode_preview_pcm(&ogg)?;
        let bytes = pcm
            .into_iter()
            .flat_map(i16::to_le_bytes)
            .collect::<Vec<_>>();
        Ok(PreviewChunkPcm {
            base64_pcm: STANDARD.encode(bytes),
            sample_rate: 48_000,
        })
    })
    .await
    .map_err(|_| "Could not read the meeting preview.".to_string())?
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
    session_id: Option<String>,
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
        if session_id
            .as_deref()
            .is_some_and(|id| id != spool.session_id())
        {
            return Err("Selected meeting changed. Choose the meeting again.".into());
        }
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

fn log_keychain_error(phase: &'static str, error: &keyring::Error) {
    let (detail, code) = credential::diagnostic_error(error);
    diagnostics::record(phase, "failed", Some(detail), code, None);
}

#[tauri::command]
async fn credential_save(origin: String, token: String) -> Result<(), String> {
    diagnostics::record("keychain.save", "requested", None, None, None);
    let secret = credential::envelope(&origin, &token).map_err(|error| {
        diagnostics::record("keychain.save", "invalid_input", None, None, None);
        error
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        diagnostics::record("keychain.save", "started", None, None, None);
        let entry =
            keyring::Entry::new(credential::service(), credential::account()).map_err(|error| {
                log_keychain_error("keychain.save", &error);
                "Could not save the credential on this device.".to_string()
            })?;
        entry.set_password(&secret).map_err(|error| {
            log_keychain_error("keychain.save", &error);
            "Could not save the credential on this device.".to_string()
        })?;
        diagnostics::record("keychain.save", "saved", None, None, None);
        Ok(())
    })
    .await
    .map_err(|_| "Could not save the credential on this device.".to_string())?
}

#[tauri::command]
async fn credential_load() -> Result<Option<credential::SavedCredential>, String> {
    diagnostics::record("keychain.load", "requested", None, None, None);
    tauri::async_runtime::spawn_blocking(|| {
        diagnostics::record("keychain.load", "started", None, None, None);
        let entry =
            keyring::Entry::new(credential::service(), credential::account()).map_err(|error| {
                log_keychain_error("keychain.load", &error);
                "Could not read the saved credential.".to_string()
            })?;
        match entry.get_password() {
            Ok(secret) => {
                let saved = credential::parse_envelope(&secret).map_err(|error| {
                    diagnostics::record("keychain.load", "invalid_entry", None, None, None);
                    error
                })?;
                diagnostics::record("keychain.load", "loaded", None, None, None);
                Ok(Some(saved))
            }
            Err(keyring::Error::NoEntry) => {
                diagnostics::record("keychain.load", "not_found", None, None, None);
                Ok(None)
            }
            Err(error) => {
                log_keychain_error("keychain.load", &error);
                Err("Could not read the saved credential.".to_string())
            }
        }
    })
    .await
    .map_err(|_| "Could not read the saved credential.".to_string())?
}

#[tauri::command]
async fn credential_clear() -> Result<(), String> {
    diagnostics::record("keychain.clear", "requested", None, None, None);
    tauri::async_runtime::spawn_blocking(|| {
        let entry =
            keyring::Entry::new(credential::service(), credential::account()).map_err(|error| {
                log_keychain_error("keychain.clear", &error);
                "Could not forget the saved credential.".to_string()
            })?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {
                diagnostics::record("keychain.clear", "cleared", None, None, None);
                Ok(())
            }
            Err(error) => {
                log_keychain_error("keychain.clear", &error);
                Err("Could not forget the saved credential.".to_string())
            }
        }
    })
    .await
    .map_err(|_| "Could not forget the saved credential.".to_string())?
}

#[tauri::command]
async fn diagnostics_export(app: AppHandle) -> Result<String, String> {
    // This command never touches the capture mutex and stays usable during a
    // stalled recording or keychain operation. The renderer cannot pick a path.
    let destination = app
        .path()
        .download_dir()
        .map_err(|_| "Could not locate the Downloads folder.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        diagnostics::export(&destination).map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "Could not export diagnostics.".to_string())?
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
    diagnostics::record("api.request", "requested", None, None, None);
    let started = Instant::now();
    let result = backend::request(backend::CompanionRequest {
        origin,
        token,
        operation,
        body,
    })
    .await;
    diagnostics::record(
        "api.request",
        if result.is_ok() {
            "completed"
        } else {
            "failed"
        },
        None,
        None,
        Some(started.elapsed().as_millis() as u64),
    );
    result.map_err(|message| ApiError { message })
}

#[cfg(target_os = "macos")]
fn log_macos_environment() {
    if let Ok(output) = std::process::Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .output()
    {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout);
            for (label, value) in ["major", "minor", "patch"]
                .into_iter()
                .zip(version.trim().split('.'))
            {
                if let Ok(number) = value.parse::<u16>() {
                    diagnostics::record(
                        "platform.macos_version",
                        "detected",
                        Some(label),
                        Some(i64::from(number)),
                        None,
                    );
                }
            }
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        let path = executable.to_string_lossy();
        let location = if path.contains("/AppTranslocation/") {
            "translocated"
        } else if path.starts_with("/Volumes/") {
            "mounted_volume"
        } else {
            "installed"
        };
        diagnostics::record(
            "platform.executable",
            "location",
            Some(location),
            None,
            None,
        );
        if let Ok(output) = std::process::Command::new("/usr/bin/codesign")
            .args(["-dv", "--verbose=2"])
            .arg(executable)
            .output()
        {
            let signature = String::from_utf8_lossy(&output.stderr);
            let kind = if !output.status.success() {
                "unavailable"
            } else if signature.contains("Signature=adhoc") {
                "adhoc"
            } else {
                "certificate"
            };
            diagnostics::record("platform.signature", "detected", Some(kind), None, None);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(CaptureSession::default())))
        .manage(ExitCleanup::default())
        .setup(|app| {
            if let Ok(directory) = app.path().app_log_dir() {
                let _ = diagnostics::init(directory);
            }
            diagnostics::record(
                "app",
                "started",
                Some("meeting-inbox-diagnostics-v8"),
                None,
                None,
            );
            diagnostics::record("platform", "os", Some(std::env::consts::OS), None, None);
            diagnostics::record("platform", "arch", Some(std::env::consts::ARCH), None, None);
            #[cfg(target_os = "macos")]
            log_macos_environment();
            let root = app.path().app_data_dir()?.join("capture-spool");
            let library = MeetingLibrary::open(root.clone())?;
            for meeting in library.list()? {
                if meeting.state == "recording" {
                    let _ = CaptureSpool::load(library.meeting_path(&meeting.session_id)?);
                }
            }
            let capture = app.state::<SharedCapture>();
            let mut capture = capture
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            capture.library_root = Some(root);
            if let Some(meeting) = library
                .list()?
                .into_iter()
                .find(|meeting| meeting.error.is_none())
            {
                if let Some(spool) = CaptureSpool::load(library.meeting_path(&meeting.session_id)?)?
                {
                    restore_selected_meeting(&mut capture, spool);
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
            read_preview_chunk,
            meeting_list,
            meeting_select,
            meeting_rename,
            meeting_mark_uploaded,
            meeting_remove,
            credential_save,
            credential_load,
            credential_clear,
            preferences::upload_permission_load,
            preferences::upload_permission_save,
            diagnostics_export,
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
    fn a_close_finishes_by_closing_the_window_only_after_capture_cleanup() {
        let cleanup = ExitCleanup::default();

        assert_eq!(cleanup.request_close(), CleanupRequest::Start);
        assert_eq!(cleanup.finish(), CleanupCompletion::CloseWindow);
        assert_eq!(cleanup.request_close(), CleanupRequest::Continue);
    }

    #[test]
    fn selecting_and_deleting_one_meeting_preserves_the_other() {
        let root = tempfile::tempdir().unwrap();
        let library = MeetingLibrary::open(root.path().join("meetings")).unwrap();
        let first = "1f2c83ab-4d6e-4a10-9f71-c11a3f4d2e80";
        let second = "2f2c83ab-4d6e-4a10-9f71-c11a3f4d2e80";
        for id in [first, second] {
            library.initialize(id, "Meeting").unwrap();
            let mut spool = CaptureSpool::create(
                library.meeting_path(id).unwrap(),
                id.into(),
                vec![Source::Microphone],
            )
            .unwrap();
            spool
                .append_chunk(
                    ChunkInfo {
                        source: Source::Microphone,
                        sequence: 0,
                        start_seconds: 0.0,
                        duration_seconds: 1.0,
                        bytes: 4,
                        sample_rate: 48_000,
                    },
                    b"OggS",
                )
                .unwrap();
            spool.stop(1.0, false).unwrap();
        }
        let mut session = CaptureSession {
            library_root: Some(library.root().to_path_buf()),
            ..Default::default()
        };
        restore_selected_meeting(
            &mut session,
            CaptureSpool::load(library.meeting_path(first).unwrap())
                .unwrap()
                .unwrap(),
        );
        restore_selected_meeting(
            &mut session,
            CaptureSpool::load(library.meeting_path(second).unwrap())
                .unwrap()
                .unwrap(),
        );
        assert_eq!(library.list().unwrap().len(), 2);
        session.discard().unwrap();
        let remaining = library.list().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].session_id, first);
        assert_eq!(remaining[0].chunks.len(), 1);
    }

    #[test]
    fn recovered_interrupted_draft_previews_and_discards_cleanly() {
        use crate::capture::lifecycle::Sources;
        use std::time::Duration;

        let root = tempfile::TempDir::new().unwrap();
        let mut spool = CaptureSpool::create(
            root.path(),
            "1f2c83ab-4d6e-4a10-9f71-c11a3f4d2e80".into(),
            vec![Source::Microphone],
        )
        .unwrap();
        spool
            .append_chunk(
                ChunkInfo {
                    source: Source::Microphone,
                    sequence: 0,
                    start_seconds: 0.0,
                    duration_seconds: 30.0,
                    bytes: 4,
                    sample_rate: 48_000,
                },
                b"OggS",
            )
            .unwrap();
        spool.stop(30.0, true).unwrap();
        // Mirror run(): a spool left recording becomes an interrupted draft
        // surfaced as ready with its chunks available for preview.
        let mut session = CaptureSession {
            lifecycle: Lifecycle {
                state: State::Ready,
                started_at: None,
                elapsed: Duration::from_secs_f64(30.0),
                sources: Sources {
                    microphone: true,
                    system: false,
                },
                tracks: Vec::new(),
                error: None,
            },
            spool: Some(Arc::new(Mutex::new(spool))),
            spool_root: Some(root.path().to_path_buf()),
            recovered: true,
            ..Default::default()
        };
        let status = session.status();
        assert!(status.recovered);
        assert_eq!(status.chunks.len(), 1);
        session
            .discard()
            .expect("a recovered draft must always discard");
        let status = session.status();
        assert!(!status.recovered);
        assert!(status.chunks.is_empty());
        assert!(CaptureSpool::load(root.path()).unwrap().is_none());
    }
}
