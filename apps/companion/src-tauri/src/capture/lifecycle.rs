use std::time::{Duration, Instant};

use serde::Serialize;

pub const MAX_CAPTURE_DURATION: Duration = Duration::from_secs(3_600);
pub const MAX_PCM_BYTES: usize = 8 * 1024 * 1024;
pub const WAV_HEADER_BYTES: usize = 44;
pub const MAX_WAV_BYTES: usize = MAX_PCM_BYTES + WAV_HEADER_BYTES;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Microphone,
    System,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize)]
pub struct Sources {
    pub microphone: bool,
    pub system: bool,
}

impl Sources {
    pub fn any(self) -> bool {
        self.microphone || self.system
    }

    pub fn includes(self, source: Source) -> bool {
        match source {
            Source::Microphone => self.microphone,
            Source::System => self.system,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub source: Source,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub bytes: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Idle,
    Recording,
    Paused,
    Ready,
    Error,
}

#[derive(Clone, Debug)]
pub struct Lifecycle {
    pub state: State,
    pub started_at: Option<Instant>,
    pub elapsed: Duration,
    pub sources: Sources,
    pub tracks: Vec<TrackInfo>,
    pub error: Option<String>,
}

impl Default for Lifecycle {
    fn default() -> Self {
        Self {
            state: State::Idle,
            started_at: None,
            elapsed: Duration::ZERO,
            sources: Sources::default(),
            tracks: Vec::new(),
            error: None,
        }
    }
}

impl Lifecycle {
    pub fn start(&mut self, sources: Sources, now: Instant) -> Result<(), String> {
        if !sources.any() {
            return Err("Select microphone, system audio, or both before recording.".into());
        }
        if self.state == State::Recording {
            return Err("A capture is already recording.".into());
        }
        *self = Self {
            state: State::Recording,
            started_at: Some(now),
            elapsed: Duration::ZERO,
            sources,
            tracks: Vec::new(),
            error: None,
        };
        Ok(())
    }

    pub fn elapsed_at(&self, now: Instant) -> Duration {
        if self.state == State::Recording {
            self.started_at
                .map(|start| {
                    self.elapsed
                        .saturating_add(now.saturating_duration_since(start))
                        .min(MAX_CAPTURE_DURATION)
                })
                .unwrap_or(self.elapsed)
        } else {
            self.elapsed
        }
    }

    pub fn is_recording_generation(&self, generation: Instant) -> bool {
        self.state == State::Recording && self.started_at == Some(generation)
    }

    pub fn reanchor_start(&mut self, now: Instant) {
        if self.state == State::Recording {
            // Keep accumulated elapsed across pause/resume; only the clock
            // origin moves so device-setup time is not billed as audio.
            self.started_at = Some(now);
        }
    }

    pub fn pause(&mut self, now: Instant) -> bool {
        if self.state != State::Recording {
            return false;
        }
        self.elapsed = self.elapsed_at(now);
        self.started_at = None;
        self.state = State::Paused;
        true
    }

    pub fn resume(&mut self, now: Instant) -> Result<(), String> {
        if self.state != State::Paused {
            return Err("There is no paused capture to resume.".into());
        }
        self.started_at = Some(now);
        self.state = State::Recording;
        Ok(())
    }

    pub fn stop(&mut self, now: Instant) -> bool {
        if self.state != State::Recording && self.state != State::Paused {
            return false;
        }
        if self.state == State::Recording {
            self.elapsed = self.elapsed_at(now);
        }
        self.started_at = None;
        self.state = State::Ready;
        true
    }

    pub fn discard(&mut self) {
        *self = Self::default();
    }

    pub fn can_read(&self, source: Source) -> bool {
        self.state == State::Ready && self.sources.includes(source)
    }

    pub fn ensure_track_size(&self, current: usize, additional: usize) -> Result<usize, String> {
        let next = current.saturating_add(additional);
        if next > MAX_PCM_BYTES {
            return Err("Capture reached the 8 MiB per-track limit.".into());
        }
        Ok(next)
    }

    pub fn fail(&mut self, message: String) {
        if self.state == State::Recording {
            self.elapsed = self.elapsed_at(Instant::now());
        }
        self.state = State::Error;
        self.started_at = None;
        self.error = Some(message);
    }
}
