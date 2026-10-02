pub mod backend;
pub mod capture;

use std::{
    sync::{Arc, Mutex},
    thread,
    time::Instant,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use capture::{
    audio::{MicrophoneCapture, RawAudio},
    codec::{encode_ogg_opus, EncodedAudio},
    lifecycle::{Lifecycle, Source, Sources, State, TrackInfo, MAX_CAPTURE_DURATION},
    SystemCapture,
};
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
            .discard();
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
    microphone_audio: Option<EncodedAudio>,
    system_audio: Option<EncodedAudio>,
    temp_dir: Option<TempDir>,
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
}

impl CaptureSession {
    fn status(&self) -> CaptureStatus {
        let state = match self.lifecycle.state {
            State::Idle => "idle",
            State::Recording => "recording",
            State::Ready => "ready",
            State::Error => "error",
        };
        let elapsed = self.lifecycle.elapsed_at(Instant::now());
        CaptureStatus {
            state,
            elapsed_seconds: elapsed.as_secs_f64(),
            tracks: self.lifecycle.tracks.clone(),
            error: self.lifecycle.error.clone(),
        }
    }

    fn stop(&mut self) {
        if self.lifecycle.state != State::Recording {
            return;
        }
        let now = Instant::now();
        let microphone = self.microphone.take().map(MicrophoneCapture::stop);
        let system = self.system.take().map(SystemCapture::stop);
        let microphone = match microphone {
            Some(audio) if audio.error.is_some() => {
                self.fail_stop(audio.error.unwrap());
                return;
            }
            Some(audio) if !has_audio_signal(&audio) => {
                self.fail_stop("The microphone returned no audible samples. Check microphone permission and the selected input device.".into());
                return;
            }
            Some(audio) => Some(audio),
            None => None,
        };
        let system = match system {
            Some(Ok(audio)) if !has_audio_signal(&audio) => {
                self.fail_stop("System audio returned no audible samples. Check system audio permission and that sound was playing during capture.".into());
                return;
            }
            Some(Ok(audio)) => Some(audio),
            Some(Err(error)) => {
                self.fail_stop(error);
                return;
            }
            None => None,
        };
        let encoded_microphone = match microphone.map(encode_ogg_opus).transpose() {
            Ok(audio) => audio,
            Err(error) => {
                self.fail_stop(error);
                return;
            }
        };
        let encoded_system = match system.map(encode_ogg_opus).transpose() {
            Ok(audio) => audio,
            Err(error) => {
                self.fail_stop(error);
                return;
            }
        };
        self.microphone_audio = encoded_microphone;
        self.system_audio = encoded_system;
        // Ogg bytes now own the ready tracks; remove the host-owned raw PCM
        // temp files immediately after encoding.
        self.temp_dir.take();
        self.lifecycle.stop(now);
        self.lifecycle.tracks.clear();
        if let Some(audio) = &self.microphone_audio {
            self.lifecycle
                .tracks
                .push(track_info(Source::Microphone, audio));
        }
        if let Some(audio) = &self.system_audio {
            self.lifecycle
                .tracks
                .push(track_info(Source::System, audio));
        }
    }

    fn fail_stop(&mut self, error: String) {
        self.microphone_audio.take();
        self.system_audio.take();
        self.temp_dir.take();
        self.lifecycle.fail(error);
    }

    fn discard(&mut self) {
        self.microphone.take();
        self.system.take();
        self.microphone_audio.take();
        self.system_audio.take();
        self.temp_dir.take();
        self.lifecycle.discard();
    }
}

fn track_info(source: Source, audio: &EncodedAudio) -> TrackInfo {
    TrackInfo {
        source,
        duration_seconds: audio.duration_seconds,
        sample_rate: audio.sample_rate,
        bytes: audio.ogg.len(),
    }
}

fn has_audio_signal(audio: &RawAudio) -> bool {
    audio.sample_rate > 0 && !audio.pcm.is_empty() && audio.pcm.iter().any(|byte| *byte != 0)
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
    capture: TauriState<'_, SharedCapture>,
    sources: StartSources,
) -> Result<CaptureStatus, String> {
    let sources = Sources {
        microphone: sources.microphone,
        system: sources.system,
    };
    let capture = capture.inner().clone();
    tauri::async_runtime::spawn_blocking(move || start_capture_blocking(capture, sources))
        .await
        .map_err(|_| "Could not start audio capture.".to_string())
}

fn start_capture_blocking(capture: SharedCapture, sources: Sources) -> CaptureStatus {
    let mut session = capture
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Err(error) = session.lifecycle.start(sources, Instant::now()) {
        if !sources.any() {
            session.lifecycle.fail(error);
        }
        return session.status();
    }
    if session.temp_dir.is_some() {
        session.discard();
        if let Err(error) = session.lifecycle.start(sources, Instant::now()) {
            session.lifecycle.fail(error);
            return session.status();
        }
    }

    let temp_dir = match tempfile::Builder::new()
        .prefix("savia-companion-")
        .tempdir()
    {
        Ok(temp_dir) => temp_dir,
        Err(_) => {
            session
                .lifecycle
                .fail("Could not prepare temporary audio storage.".into());
            return session.status();
        }
    };
    if sources.microphone {
        if let Err(error) = capture::authorize_microphone(temp_dir.path()) {
            session.lifecycle.fail(error);
            return session.status();
        }
    }
    session.temp_dir = Some(temp_dir);
    if sources.system {
        let started = match session.temp_dir.as_ref() {
            Some(temp_dir) => SystemCapture::start(temp_dir.path()),
            None => Err("Could not prepare temporary audio storage.".into()),
        };
        match started {
            Ok(system) => session.system = Some(system),
            Err(error) => {
                session.discard();
                session.lifecycle.fail(error);
                return session.status();
            }
        }
    }
    if sources.microphone {
        match MicrophoneCapture::start() {
            Ok(microphone) => session.microphone = Some(microphone),
            Err(error) => {
                session.discard();
                session.lifecycle.fail(error);
                return session.status();
            }
        }
    }
    let generation = Instant::now();
    session.lifecycle.reanchor_start(generation);
    drop(session);

    let stop_capture = capture.clone();
    thread::spawn(move || {
        thread::sleep(MAX_CAPTURE_DURATION);
        let mut session = stop_capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if session.lifecycle.is_recording_generation(generation) {
            session.stop();
        }
    });
    capture
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .status()
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
        capture.discard();
        capture.status()
    })
    .await
    .map_err(|_| "Could not discard audio capture.".to_string())
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
        if !capture.lifecycle.can_read(source) {
            return Err("Captured audio is available only after recording has stopped.".into());
        }
        let audio = match source {
            Source::Microphone => capture.microphone_audio.as_ref(),
            Source::System => capture.system_audio.as_ref(),
        }
        .ok_or_else(|| "No captured audio is available for that source.".to_string())?;
        Ok(ReadCapture {
            base64: STANDARD.encode(&audio.ogg),
            format: "ogg",
            duration_seconds: audio.duration_seconds,
        })
    })
    .await
    .map_err(|_| "Could not read captured audio.".to_string())?
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
        .invoke_handler(tauri::generate_handler![
            capture_status,
            start_capture,
            stop_capture,
            discard_capture,
            read_capture,
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
            RunEvent::Exit => {
                let capture = app.state::<SharedCapture>().inner().clone();
                capture
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .discard();
            }
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
