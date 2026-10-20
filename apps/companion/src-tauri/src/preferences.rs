//! Private, persistent native preferences for the companion.

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "upload-permission.json";
const MAX_FILE_BYTES: u64 = 256;
static WRITE_LOCK: Mutex<()> = Mutex::new(());
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UploadPermission {
    version: u8,
    accepted: bool,
}

/// Read whether the user has accepted the upload permission disclaimer.
/// Missing, oversized, malformed, or inaccessible files always fail closed.
#[tauri::command]
pub fn upload_permission_load(app: AppHandle) -> bool {
    let Ok(directory) = app.path().app_data_dir() else {
        return false;
    };
    read_permission(&directory)
}

/// Save the user's explicit upload permission preference.
#[tauri::command]
pub fn upload_permission_save(app: AppHandle, accepted: bool) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not save upload permission.".to_string())?;
    write_permission(&directory, accepted)
}

fn read_permission(directory: &Path) -> bool {
    let path = directory.join(FILE_NAME);
    let Ok(metadata) = fs::symlink_metadata(&path) else {
        return false;
    };
    if !metadata.file_type().is_file() || metadata.len() > MAX_FILE_BYTES {
        return false;
    }
    let Ok(file) = File::open(path) else {
        return false;
    };
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    if file
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_FILE_BYTES
    {
        return false;
    }
    serde_json::from_slice::<UploadPermission>(&bytes)
        .ok()
        .filter(|preference| preference.version == 1)
        .map(|preference| preference.accepted)
        .unwrap_or(false)
}

fn write_permission(directory: &Path, accepted: bool) -> Result<(), String> {
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    fs::create_dir_all(directory).map_err(|_| "Could not save upload permission.".to_string())?;
    set_private_directory(directory)?;

    let target = directory.join(FILE_NAME);
    // Refuse to replace a link or other unexpected path in the app-data folder.
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if !metadata.file_type().is_file() {
            return Err("Could not save upload permission.".into());
        }
    }

    let data = serde_json::to_vec(&UploadPermission {
        version: 1,
        accepted,
    })
    .map_err(|_| "Could not save upload permission.".to_string())?;
    let (temp_path, mut file) = create_private_temp(directory)?;
    let result = (|| {
        file.write_all(&data)
            .map_err(|_| "Could not save upload permission.".to_string())?;
        file.sync_all()
            .map_err(|_| "Could not save upload permission.".to_string())?;
        drop(file);
        replace_atomically(&temp_path, &target)
            .map_err(|_| "Could not save upload permission.".to_string())?;
        sync_directory(directory).map_err(|_| "Could not save upload permission.".to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp_path);
    }
    result
}

fn create_private_temp(directory: &Path) -> Result<(PathBuf, File), String> {
    for _ in 0..16 {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!(
            ".{FILE_NAME}.{}.{}.tmp",
            std::process::id(),
            sequence
        ));
        match private_file_create_new(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Could not save upload permission.".into()),
        }
    }
    Err("Could not save upload permission.".into())
}

fn private_file_create_new(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    set_private_file(&file)?;
    Ok(file)
}

fn replace_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    if target.exists() {
        // Windows rename does not replace an existing file. Preserve atomicity
        // with MoveFileExW when updating an existing preference.
        return replace_existing_windows(source, target);
    }
    fs::rename(source, target)
}

#[cfg(windows)]
fn replace_existing_windows(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

    let source: Vec<u16> = OsStr::new(source).encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = OsStr::new(target).encode_wide().chain(Some(0)).collect();
    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> std::io::Result<()> {
    File::open(directory)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_private_directory(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Could not secure upload permission storage.".into())
}

#[cfg(not(unix))]
fn set_private_directory(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file(file: &File) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_file(_: &File) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn absent_preference_defaults_to_false_then_survives_reopen_and_reset() {
        let directory = TempDir::new().unwrap();
        assert!(!read_permission(directory.path()));

        write_permission(directory.path(), true).unwrap();
        assert!(read_permission(directory.path()));

        // A second read is the same operation a fresh app process performs.
        assert!(read_permission(directory.path()));
        write_permission(directory.path(), false).unwrap();
        assert!(!read_permission(directory.path()));
    }

    #[test]
    fn malformed_and_oversized_files_fail_closed() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join(FILE_NAME);
        fs::write(&path, b"{broken").unwrap();
        assert!(!read_permission(directory.path()));

        fs::write(&path, vec![b' '; MAX_FILE_BYTES as usize + 1]).unwrap();
        assert!(!read_permission(directory.path()));
    }

    #[cfg(unix)]
    #[test]
    fn stored_preference_and_directory_have_private_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let directory = TempDir::new().unwrap();
        write_permission(directory.path(), true).unwrap();
        let dir_mode = fs::metadata(directory.path()).unwrap().permissions().mode() & 0o777;
        let file_mode = fs::metadata(directory.path().join(FILE_NAME))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(dir_mode, 0o700);
        assert_eq!(file_mode, 0o600);
    }
}
