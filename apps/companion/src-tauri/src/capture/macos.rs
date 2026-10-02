use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio},
    sync::mpsc,
    thread::{self, JoinHandle},
    time::Duration,
};

use super::audio::RawAudio;
use super::lifecycle::MAX_PCM_BYTES;

const EMBEDDED_HELPER: &[u8] = include_bytes!(env!("SAVIA_CAPTURE_HELPER"));
const STARTUP_TIMEOUT: Duration = Duration::from_secs(12);
const MICROPHONE_AUTH_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_STARTUP_ERROR_BYTES: u64 = 4096;

pub struct SystemCapture {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    _stdout: Option<ChildStdout>,
    stderr_worker: Option<JoinHandle<String>>,
    output: PathBuf,
    sample_rate: u32,
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

    pub fn start(temp_dir: &Path) -> Result<Self, String> {
        let helper = helper_path(temp_dir)?;
        let output = temp_dir.join("system.pcm");
        let mut command = Command::new(&helper);
        command.arg(&output);
        Self::start_helper(command, output, STARTUP_TIMEOUT)
    }

    fn start_helper(
        mut command: Command,
        output: PathBuf,
        timeout: Duration,
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
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            let result = reader
                .read_line(&mut line)
                .map(|_| (line, reader.into_inner()));
            let _ = ready_sender.send(result);
        });
        let stderr_thread = thread::spawn(move || collect_stderr(stderr));
        let readiness = ready_receiver.recv_timeout(timeout);
        let (line, stdout) = match readiness {
            Ok(Ok((line, stdout))) => (line, stdout),
            Ok(Err(_)) => {
                kill_child(&mut child);
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err("Could not read the macOS capture startup result.".into());
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
        Ok(Self {
            child: Some(child),
            stdin: Some(stdin),
            _stdout: Some(stdout),
            stderr_worker: Some(stderr_thread),
            output,
            sample_rate,
        })
    }

    pub fn stop(mut self) -> Result<RawAudio, String> {
        if let Some(mut stdin) = self.stdin.take() {
            stdin
                .write_all(b"stop\n")
                .map_err(|_| "Could not stop the macOS system audio stream cleanly.".to_string())?;
            stdin
                .flush()
                .map_err(|_| "Could not finalize system audio capture.".to_string())?;
        }
        if let Some(mut child) = self.child.take() {
            let status = wait_child(&mut child)?;
            if !status.success() {
                return Err("macOS could not finalize system audio capture.".into());
            }
        }
        if let Some(worker) = self.stderr_worker.take() {
            let _ = worker.join();
        }
        let metadata = fs::metadata(&self.output)
            .map_err(|_| "macOS did not produce system audio samples.".to_string())?;
        if metadata.len() > MAX_PCM_BYTES as u64 {
            return Err("Capture reached the 8 MiB per-track limit.".into());
        }
        let pcm = fs::read(&self.output)
            .map_err(|_| "Could not read the captured system audio samples.".to_string())?;
        Ok(RawAudio {
            pcm,
            sample_rate: self.sample_rate,
            error: None,
        })
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
        if let Some(mut stdin) = self.stdin.take() {
            let _ = stdin.write_all(b"stop\n");
            let _ = stdin.flush();
        }
        if let Some(mut child) = self.child.take() {
            let _ = wait_child(&mut child);
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

    #[test]
    fn startup_timeout_kills_a_helper_that_never_sends_ready() {
        let started = std::time::Instant::now();
        let error = SystemCapture::start_helper(
            shell_command("exec sleep 30"),
            PathBuf::from("unused.pcm"),
            Duration::from_millis(100),
        )
        .err()
        .expect("startup should time out");

        assert!(error.contains("did not become ready"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn helper_failure_reads_bounded_stderr_without_waiting_for_a_live_child() {
        let error = SystemCapture::start_helper(
            shell_command("printf 'could not create the system audio tap\\n' >&2; exit 1"),
            PathBuf::from("unused.pcm"),
            Duration::from_secs(1),
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
