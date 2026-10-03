use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use super::{
    lifecycle::{Source, MAX_PCM_BYTES},
    segments::{SegmentAssembler, SegmentWorker},
    spool::CaptureSpool,
};

const EMBEDDED_HELPER: &[u8] = include_bytes!(env!("SAVIA_CAPTURE_HELPER"));
const STARTUP_TIMEOUT: Duration = Duration::from_secs(12);
const MICROPHONE_AUTH_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_STARTUP_ERROR_BYTES: u64 = 4096;

pub struct SystemCapture {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stderr_worker: Option<JoinHandle<String>>,
    stdout_worker: Option<JoinHandle<Result<(), String>>>,
    segments: Option<SegmentWorker>,
}

impl SystemCapture {
    pub fn authorize_microphone(temp_dir: &Path) -> Result<(), String> {
        let helper = helper_path(temp_dir)?;
        let mut command = Command::new(helper);
        command.arg("--authorize-microphone");
        let (status, _stdout, stderr) =
            bounded_helper_output(&mut command, MICROPHONE_AUTH_TIMEOUT)?;
        if status.success() {
            return Ok(());
        }
        let details = String::from_utf8_lossy(&stderr);
        if details.contains("Microphone permission was denied") {
            Err("Microphone permission was denied. Enable it in System Settings > Privacy & Security > Microphone.".into())
        } else {
            Err("macOS could not request microphone permission.".into())
        }
    }

    pub fn start(
        temp_dir: &Path,
        spool: Arc<Mutex<CaptureSpool>>,
        origin: Instant,
    ) -> Result<Self, String> {
        let helper = helper_path(temp_dir)?;
        let command = Command::new(&helper);
        Self::start_helper(command, STARTUP_TIMEOUT, spool, origin)
    }

    fn start_helper(
        mut command: Command,
        timeout: Duration,
        spool: Arc<Mutex<CaptureSpool>>,
        origin: Instant,
    ) -> Result<Self, String> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|_| "Could not start the macOS system audio capture helper.".to_string())?;
        let Some(stdout) = child.stdout.take() else {
            kill_child(&mut child);
            return Err("The macOS capture helper did not start.".into());
        };
        let Some(stderr) = child.stderr.take() else {
            kill_child(&mut child);
            return Err("The macOS capture helper did not start.".into());
        };
        let (ready_sender, ready_receiver) = mpsc::channel();
        let stdout_thread = thread::spawn(move || {
            let result = read_ready_line(stdout);
            let _ = ready_sender.send(result);
        });
        let stderr_thread = thread::spawn(move || collect_stderr(stderr));
        let readiness = ready_receiver.recv_timeout(timeout);
        let (line, stdout) = match readiness {
            Ok(Ok((line, stdout))) => (line, stdout),
            Ok(Err(_)) => {
                kill_child(&mut child);
                let _ = stdout_thread.join();
                let details = stderr_thread.join().unwrap_or_default();
                let message = if details.contains("could not create the system audio tap")
                    || details.contains("capture permission")
                {
                    "macOS could not start the system audio tap. Check System Settings > Privacy & Security > Screen & System Audio Recording."
                } else if details.contains("macOS 14.2") {
                    "System audio capture requires macOS 14.2 or later."
                } else {
                    "Could not read the macOS capture startup result."
                };
                return Err(message.into());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                kill_child(&mut child);
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err("macOS system audio capture did not become ready within 12 seconds. Check system audio recording permission and try again.".into());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                kill_child(&mut child);
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err("The macOS capture helper stopped before it was ready.".into());
            }
        };
        if !line.starts_with("READY ") {
            kill_child(&mut child);
            let _ = stdout_thread.join();
            let details = stderr_thread.join().unwrap_or_default();
            let sanitized = if details.contains("macOS 14.2") {
                "System audio capture requires macOS 14.2 or later.".to_string()
            } else if details.contains("unsupported system audio format") {
                "This system output format is not supported for capture.".to_string()
            } else if details.contains("could not create the system audio tap")
                || details.contains("capture permission")
            {
                "macOS could not start the system audio tap. Check System Settings > Privacy & Security > Screen & System Audio Recording.".to_string()
            } else {
                "macOS denied or could not initialize system audio capture. Check the app's audio recording permissions.".to_string()
            };
            return Err(sanitized);
        }
        let _ = stdout_thread.join();
        let sample_rate = line[6..]
            .trim()
            .parse::<u32>()
            .ok()
            .filter(|rate| (8_000..=96_000).contains(rate))
            .ok_or_else(|| {
                "macOS returned an invalid or unsupported system audio sample rate.".to_string()
            });
        let sample_rate = match sample_rate {
            Ok(sample_rate) => sample_rate,
            Err(error) => {
                kill_child(&mut child);
                let _ = stderr_thread.join();
                return Err(error);
            }
        };
        let Some(stdin) = child.stdin.take() else {
            kill_child(&mut child);
            let _ = stderr_thread.join();
            return Err("The macOS capture helper has no control pipe.".into());
        };
        let segments = SegmentWorker::start(
            Source::System,
            sample_rate,
            origin.elapsed().as_secs_f64(),
            spool,
        )?;
        let assembler = segments.assembler();
        let stdout_worker = thread::Builder::new()
            .name("savia-macos-segment-reader".into())
            .spawn(move || read_segments(stdout, assembler))
            .map_err(|_| "Could not start the macOS audio segment reader.".to_string())?;
        Ok(Self {
            child: Some(child),
            stdin: Some(stdin),
            stderr_worker: Some(stderr_thread),
            stdout_worker: Some(stdout_worker),
            segments: Some(segments),
        })
    }

    pub fn stop(mut self) -> Result<(), String> {
        self.request_stop()?;
        if let Some(mut child) = self.child.take() {
            let status = wait_child(&mut child)?;
            if !status.success() {
                return Err("macOS could not finalize system audio capture.".into());
            }
        }
        let reader_result = self
            .stdout_worker
            .take()
            .map(|worker| {
                worker.join().map_err(|_| {
                    "The macOS audio segment reader stopped unexpectedly.".to_string()
                })?
            })
            .unwrap_or(Ok(()));
        let segment_result = self
            .segments
            .take()
            .map(SegmentWorker::finish)
            .unwrap_or(Ok(()));
        if let Some(worker) = self.stderr_worker.take() {
            let _ = worker.join();
        }
        reader_result?;
        segment_result
    }

    pub fn request_stop(&mut self) -> Result<(), String> {
        if let Some(mut stdin) = self.stdin.take() {
            stdin
                .write_all(b"stop\n")
                .map_err(|_| "Could not stop the macOS system audio stream cleanly.".to_string())?;
            stdin
                .flush()
                .map_err(|_| "Could not finalize system audio capture.".to_string())?;
        }
        Ok(())
    }
}

fn read_ready_line(mut stdout: ChildStdout) -> std::io::Result<(String, ChildStdout)> {
    let mut line = Vec::with_capacity(32);
    loop {
        let mut byte = [0u8; 1];
        stdout.read_exact(&mut byte)?;
        if byte[0] == b'\n' {
            break;
        }
        if line.len() >= 128 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "capture helper readiness line is too long",
            ));
        }
        line.push(byte[0]);
    }
    Ok((String::from_utf8_lossy(&line).into_owned(), stdout))
}

fn read_segments(
    mut stdout: ChildStdout,
    assembler: Arc<Mutex<SegmentAssembler>>,
) -> Result<(), String> {
    loop {
        let mut header = [0u8; 16];
        let mut first = [0u8; 1];
        match stdout.read(&mut first) {
            Ok(0) => return Ok(()),
            Ok(_) => header[0] = first[0],
            Err(_) => return Err("Could not read a macOS system audio segment.".into()),
        }
        stdout
            .read_exact(&mut header[1..])
            .map_err(|_| "macOS sent an incomplete audio segment header.".to_string())?;
        if &header[..4] != b"SSEG" {
            return Err("macOS sent an invalid audio segment header.".into());
        }
        let start_nanos = u64::from_le_bytes(header[4..12].try_into().unwrap());
        let size = u32::from_le_bytes(header[12..16].try_into().unwrap()) as usize;
        if size == 0 || size > MAX_PCM_BYTES || size % 2 != 0 {
            return Err("macOS sent an oversized or malformed audio segment.".into());
        }
        let mut pcm = vec![0; size];
        stdout
            .read_exact(&mut pcm)
            .map_err(|_| "macOS sent an incomplete audio segment.".to_string())?;
        assembler
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push_external_segment(start_nanos as f64 / 1_000_000_000.0, pcm)?;
    }
}

fn helper_path(temp_dir: &Path) -> Result<PathBuf, String> {
    let helper = temp_dir.join("savia-capture-macos");
    fs::write(&helper, EMBEDDED_HELPER)
        .map_err(|_| "Could not prepare the macOS capture helper.".to_string())?;
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Could not authorize the macOS capture helper.".to_string())?;
    Ok(helper)
}

impl Drop for SystemCapture {
    fn drop(&mut self) {
        let _ = self.request_stop();
        if let Some(mut child) = self.child.take() {
            let _ = wait_child(&mut child);
        }
        if let Some(worker) = self.stdout_worker.take() {
            let _ = worker.join();
        }
        if let Some(segments) = self.segments.take() {
            let _ = segments.finish();
        }
        if let Some(worker) = self.stderr_worker.take() {
            let _ = worker.join();
        }
    }
}

fn kill_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn collect_stderr(stderr: std::process::ChildStderr) -> String {
    let mut reader = stderr;
    let mut captured = Vec::new();
    let mut buffer = [0u8; 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                let remaining = (MAX_STARTUP_ERROR_BYTES as usize).saturating_sub(captured.len());
                captured.extend_from_slice(&buffer[..count.min(remaining)]);
            }
        }
    }
    String::from_utf8_lossy(&captured).into_owned()
}

fn bounded_helper_output(
    command: &mut Command,
    timeout: Duration,
) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start the macOS permission helper.".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| {
        kill_child(&mut child);
        "The macOS permission helper did not start.".to_string()
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        kill_child(&mut child);
        "The macOS permission helper did not start.".to_string()
    })?;
    let stdout_worker = thread::spawn(move || collect_bytes(stdout));
    let stderr_worker = thread::spawn(move || collect_bytes(stderr));
    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                kill_child(&mut child);
                let _ = stdout_worker.join();
                let _ = stderr_worker.join();
                return Err("Microphone permission did not resolve within 60 seconds. Check the macOS microphone permission prompt and try again.".into());
            }
            Err(_) => {
                kill_child(&mut child);
                let _ = stdout_worker.join();
                let _ = stderr_worker.join();
                return Err("Could not check microphone permission.".into());
            }
        }
    };
    let stdout = stdout_worker.join().unwrap_or_default();
    let stderr = stderr_worker.join().unwrap_or_default();
    Ok((status, stdout, stderr))
}

fn collect_bytes(mut reader: impl Read) -> Vec<u8> {
    let mut captured = Vec::new();
    let mut buffer = [0u8; 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                let remaining = (MAX_STARTUP_ERROR_BYTES as usize).saturating_sub(captured.len());
                captured.extend_from_slice(&buffer[..count.min(remaining)]);
            }
        }
    }
    captured
}

fn wait_child(child: &mut Child) -> Result<std::process::ExitStatus, String> {
    for _ in 0..30 {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    child
        .wait()
        .map_err(|_| "Could not stop the macOS audio helper.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell_command(script: &str) -> Command {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]);
        command
    }

    fn spool() -> (tempfile::TempDir, Arc<Mutex<CaptureSpool>>) {
        let dir = tempfile::tempdir().unwrap();
        let spool = CaptureSpool::create(
            dir.path(),
            "1f2c83ab-4d6e-4a10-9f71-c11a3f4d2e80".into(),
            vec![Source::System],
        )
        .unwrap();
        (dir, Arc::new(Mutex::new(spool)))
    }

    #[test]
    fn startup_timeout_kills_a_helper_that_never_sends_ready() {
        let started = std::time::Instant::now();
        let (_dir, spool) = spool();
        let error = SystemCapture::start_helper(
            shell_command("exec sleep 30"),
            Duration::from_millis(100),
            spool,
            Instant::now(),
        )
        .err()
        .expect("startup should time out");

        assert!(error.contains("did not become ready"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn helper_failure_reads_bounded_stderr_without_waiting_for_a_live_child() {
        let (_dir, spool) = spool();
        let error = SystemCapture::start_helper(
            shell_command("printf 'could not create the system audio tap\\n' >&2; exit 1"),
            Duration::from_secs(1),
            spool,
            Instant::now(),
        )
        .err()
        .expect("helper should fail before READY");

        assert!(error.contains("Check System Settings"));
    }

    #[test]
    fn microphone_authorization_helper_is_bounded() {
        let started = std::time::Instant::now();
        let mut command = shell_command("exec sleep 30");
        let error = bounded_helper_output(&mut command, Duration::from_millis(100))
            .err()
            .expect("authorization should time out");

        assert!(error.contains("permission did not resolve"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
