//! Private, bounded diagnostics for support bundles.
//!
//! Callers must pass source-code labels and numeric values only. The label
//! shape check rejects common raw-value forms, but is not a privacy guarantee.
//! Never pass runtime data such as errors, paths, URLs, filenames, or device
//! names to this module.

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const BUILD_LABEL: &str = "meeting-inbox-diagnostics-v8";
const FILE_LIMIT: u64 = 256 * 1024;
const CURRENT_FILE: &str = "diagnostics.jsonl";
const PREVIOUS_FILE: &str = "diagnostics.previous.jsonl";
const LABEL_LIMIT: usize = 64;

static LOGGER: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

/// Initialize the diagnostics directory. Repeated initialization with the same
/// directory is safe; switching directories during a process is rejected.
pub fn init(dir: PathBuf) -> Result<(), String> {
    let dir = prepare_private_directory(&dir)
        .map_err(|_| "diagnostics directory unavailable".to_owned())?;
    let logger = LOGGER.get_or_init(|| Mutex::new(None));
    let mut guard = logger
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    match guard.as_ref() {
        Some(existing) if existing != &dir => Err("diagnostics already initialized".to_owned()),
        Some(_) => Ok(()),
        None => {
            let state = LoggerState { dir };
            state
                .ensure_current()
                .map_err(|_| "diagnostics storage unavailable".to_owned())?;
            *guard = Some(state.dir);
            Ok(())
        }
    }
}

/// Append one privacy-filtered event. Logging failures are deliberately
/// swallowed so diagnostics can never turn a capture operation into a failure.
pub fn record(
    phase: &'static str,
    outcome: &'static str,
    detail: Option<&'static str>,
    code: Option<i64>,
    duration_ms: Option<u64>,
) {
    if !valid_label(phase)
        || !valid_label(outcome)
        || detail.is_some_and(|value| !valid_label(value))
    {
        return;
    }
    let Some(logger) = LOGGER.get() else { return };
    let guard = logger
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(dir) = guard.as_ref() else { return };
    let _ =
        LoggerState { dir: dir.clone() }.append_event(phase, outcome, detail, code, duration_ms);
}

/// Export the retained previous and current JSONL files into a unique private
/// file in `destination_dir`, returning its path to the caller.
pub fn export(destination_dir: &Path) -> Result<PathBuf, String> {
    let logger = LOGGER
        .get()
        .ok_or_else(|| "diagnostics unavailable".to_owned())?;
    let guard = logger
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let dir = guard
        .as_ref()
        .ok_or_else(|| "diagnostics unavailable".to_owned())?;

    fs::create_dir_all(destination_dir).map_err(|_| "export destination unavailable".to_owned())?;
    export_from(&LoggerState { dir: dir.clone() }, destination_dir)
}

fn export_from(state: &LoggerState, destination_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(destination_dir).map_err(|_| "export destination unavailable".to_owned())?;
    let mut bytes = Vec::new();
    for source_name in [PREVIOUS_FILE, CURRENT_FILE] {
        let source = state.dir.join(source_name);
        match File::open(source) {
            Ok(mut file) => {
                let next_len = bytes
                    .len()
                    .checked_add(
                        file.metadata()
                            .map_err(|_| "diagnostics export failed".to_owned())?
                            .len() as usize,
                    )
                    .ok_or_else(|| "diagnostics export failed".to_owned())?;
                if next_len > (FILE_LIMIT * 2) as usize {
                    return Err("diagnostics export exceeds size limit".to_owned());
                }
                file.read_to_end(&mut bytes)
                    .map_err(|_| "diagnostics export failed".to_owned())?;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err("diagnostics export failed".to_owned()),
        };
    }

    let timestamp = now_ms();
    for attempt in 0..32u8 {
        let suffix = if attempt == 0 {
            String::new()
        } else {
            format!("-{attempt}")
        };
        let destination = destination_dir.join(format!(
            "savia-companion-diagnostics-{timestamp}{suffix}.jsonl"
        ));
        match private_file_create_new(&destination) {
            Ok(mut output) => {
                if output
                    .write_all(&bytes)
                    .and_then(|_| output.sync_all())
                    .is_err()
                {
                    drop(output);
                    let _ = fs::remove_file(&destination);
                    return Err("diagnostics export failed".to_owned());
                }
                return Ok(destination);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("export destination unavailable".to_owned()),
        }
    }
    Err("could not create unique diagnostics export".to_owned())
}

struct LoggerState {
    dir: PathBuf,
}

impl LoggerState {
    fn ensure_current(&self) -> io::Result<()> {
        let path = self.dir.join(CURRENT_FILE);
        match private_file_create_new(&path) {
            Ok(mut file) => {
                let line = header_line();
                file.write_all(&line)?;
                file.sync_all()
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let file = OpenOptions::new().read(true).append(true).open(&path)?;
                set_private_file_mode(&file)?;
                let length = file.metadata()?.len();
                if length > FILE_LIMIT {
                    self.rotate()?;
                    self.create_current()
                } else if length == 0 {
                    drop(file);
                    self.append_line(&header_line())
                } else {
                    Ok(())
                }
            }
            Err(error) => Err(error),
        }
    }

    fn append_event(
        &self,
        phase: &'static str,
        outcome: &'static str,
        detail: Option<&'static str>,
        code: Option<i64>,
        duration_ms: Option<u64>,
    ) -> io::Result<()> {
        if !valid_label(phase)
            || !valid_label(outcome)
            || detail.is_some_and(|value| !valid_label(value))
        {
            return Ok(());
        }
        self.ensure_current()?;
        let line = event_line(phase, outcome, detail, code, duration_ms);
        if line.len() as u64 > FILE_LIMIT {
            return Ok(());
        }
        let path = self.dir.join(CURRENT_FILE);
        let length = fs::metadata(&path)?.len();
        if length.saturating_add(line.len() as u64) > FILE_LIMIT {
            self.rotate()?;
            self.create_current()?;
        }
        self.append_line(&line)
    }

    fn append_line(&self, line: &[u8]) -> io::Result<()> {
        let path = self.dir.join(CURRENT_FILE);
        let mut file = OpenOptions::new().append(true).open(path)?;
        set_private_file_mode(&file)?;
        file.write_all(line)?;
        Ok(())
    }

    fn create_current(&self) -> io::Result<()> {
        let path = self.dir.join(CURRENT_FILE);
        let mut file = private_file_create_new(&path)?;
        let header = header_line();
        file.write_all(&header)?;
        file.sync_all()
    }

    fn rotate(&self) -> io::Result<()> {
        let current = self.dir.join(CURRENT_FILE);
        let previous = self.dir.join(PREVIOUS_FILE);
        match fs::remove_file(&previous) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        match fs::rename(current, previous) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

fn prepare_private_directory(path: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a directory",
        ));
    }
    set_private_directory_mode(path)?;
    fs::canonicalize(path)
}

fn private_file_create_new(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    set_private_file_mode(&file)?;
    Ok(file)
}

#[cfg(unix)]
fn set_private_directory_mode(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_private_directory_mode(_path: &Path) -> io::Result<()> {
    // On Windows, newly created app-data directories inherit the user's ACL.
    Ok(())
}

#[cfg(unix)]
fn set_private_file_mode(file: &File) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_file_mode(_file: &File) -> io::Result<()> {
    Ok(())
}

fn valid_label(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= LABEL_LIMIT
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
}

fn header_line() -> Vec<u8> {
    json_line(serde_json::json!({
        "type": "header",
        "timestamp_ms": now_ms(),
        "build": BUILD_LABEL,
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    }))
}

fn event_line(
    phase: &'static str,
    outcome: &'static str,
    detail: Option<&'static str>,
    code: Option<i64>,
    duration_ms: Option<u64>,
) -> Vec<u8> {
    json_line(serde_json::json!({
        "type": "event",
        "timestamp_ms": now_ms(),
        "build": BUILD_LABEL,
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "phase": phase,
        "outcome": outcome,
        "detail": detail,
        "code": code,
        "duration_ms": duration_ms,
    }))
}

fn json_line(value: serde_json::Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(&value).unwrap_or_default();
    bytes.push(b'\n');
    bytes
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn test_dir(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("savia-diagnostics-{name}-{}", now_ms()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn lines(path: &Path) -> Vec<serde_json::Value> {
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn initializes_private_jsonl_and_preserves_records_across_reopen() {
        let dir = test_dir("restart");
        let state = LoggerState { dir: dir.clone() };
        prepare_private_directory(&dir).unwrap();
        state.ensure_current().unwrap();
        state
            .append_event(
                "keychain",
                "failed",
                Some("access_denied"),
                Some(17),
                Some(23),
            )
            .unwrap();
        let first = lines(&dir.join(CURRENT_FILE));
        assert_eq!(first[0]["type"], "header");
        assert_eq!(first[0]["build"], BUILD_LABEL);
        assert_eq!(first[1]["phase"], "keychain");
        assert_eq!(first[1]["detail"], "access_denied");
        assert!(first[1]["timestamp_ms"].as_u64().is_some());
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(dir.join(CURRENT_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );

        let reopened = LoggerState { dir: dir.clone() };
        reopened.ensure_current().unwrap();
        reopened
            .append_event("api", "retry", None, None, Some(44))
            .unwrap();
        let after_restart = lines(&dir.join(CURRENT_FILE));
        assert_eq!(after_restart.len(), 3);
        assert_eq!(after_restart[2]["phase"], "api");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rotates_to_one_previous_file_and_keeps_combined_size_bounded() {
        let dir = test_dir("rotation");
        prepare_private_directory(&dir).unwrap();
        let state = LoggerState { dir: dir.clone() };
        state.ensure_current().unwrap();
        for _ in 0..9000 {
            state
                .append_event("recording", "chunk_saved", Some("ok"), None, Some(30))
                .unwrap();
        }
        let current = fs::metadata(dir.join(CURRENT_FILE)).unwrap().len();
        let previous = fs::metadata(dir.join(PREVIOUS_FILE)).unwrap().len();
        assert!(current <= FILE_LIMIT);
        assert!(previous <= FILE_LIMIT);
        assert!(current + previous <= 512 * 1024);
        assert_eq!(lines(&dir.join(CURRENT_FILE))[0]["type"], "header");
        assert_eq!(lines(&dir.join(PREVIOUS_FILE))[0]["type"], "header");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_values_outside_the_documented_label_shape() {
        let dir = test_dir("filter");
        prepare_private_directory(&dir).unwrap();
        let state = LoggerState { dir: dir.clone() };
        state.ensure_current().unwrap();
        assert!(state
            .append_event(
                "api",
                "failed",
                Some("https://example.test/key"),
                None,
                None
            )
            .is_ok());
        assert_eq!(
            fs::metadata(dir.join(CURRENT_FILE)).unwrap().len(),
            header_line().len() as u64
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn exports_previous_then_current_to_private_unique_file() {
        let dir = test_dir("export-source");
        let destination = test_dir("export-destination");
        prepare_private_directory(&dir).unwrap();
        let state = LoggerState { dir: dir.clone() };
        state.ensure_current().unwrap();
        fs::write(dir.join(PREVIOUS_FILE), b"{\"type\":\"previous\"}\n").unwrap();
        state.append_event("api", "ok", None, None, None).unwrap();
        let output = export_from(&state, &destination).unwrap();
        let output_text = fs::read_to_string(&output).unwrap();
        assert!(output_text.starts_with("{\"type\":\"previous\"}\n"));
        assert!(output_text.contains("\"phase\":\"api\""));
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&output).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_ne!(export_from(&state, &destination).unwrap(), output);
        fs::remove_dir_all(&dir).unwrap();
        fs::remove_dir_all(&destination).unwrap();
    }
}
