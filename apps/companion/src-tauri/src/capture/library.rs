//! Private, persistent library of independently stored meetings.
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use super::spool::{CaptureSpool, ChunkInfo, DraftState};

// Serialize metadata read/modify/write across independent Tauri commands.
static METADATA_UPDATE: Mutex<()> = Mutex::new(());

const METADATA_NAME: &str = "meeting.json";
const MAX_METADATA_BYTES: u64 = 16 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMeeting {
    pub session_id: String,
    pub name: String,
    pub created_at_ms: u64,
    pub state: String,
    pub elapsed_seconds: f64,
    pub chunks: Vec<ChunkInfo>,
    pub uploaded_origin: Option<String>,
    pub error: Option<String>,
    pub recovered: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    version: u8,
    session_id: String,
    name: String,
    created_at_ms: u64,
    uploaded_origin: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MeetingLibrary {
    root: PathBuf,
}

impl MeetingLibrary {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        recover_migration(&root)?;
        fs::create_dir_all(&root)
            .map_err(|_| "Could not prepare private meeting storage.".to_string())?;
        set_private_dir(&root)?;
        let library = Self { root };
        library.migrate_legacy_draft()?;
        Ok(library)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn meeting_path(&self, id: &str) -> Result<PathBuf, String> {
        validate_uuid(id)?;
        let path = self.root.join(id);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_dir() => Ok(path),
            Ok(_) => Err("Meeting storage path is invalid.".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path),
            Err(_) => Err("Could not inspect meeting storage.".into()),
        }
    }

    pub fn initialize(&self, id: &str, name: &str) -> Result<(), String> {
        let path = self.meeting_path(id)?;
        validate_name(name)?;
        fs::create_dir(&path).map_err(|_| "Could not create meeting storage.".to_string())?;
        set_private_dir(&path)?;
        let metadata = Metadata {
            version: 1,
            session_id: id.to_owned(),
            name: name.trim().to_owned(),
            created_at_ms: now_ms(),
            uploaded_origin: None,
        };
        if let Err(error) = write_metadata(&path, &metadata) {
            let _ = fs::remove_dir_all(&path);
            return Err(error);
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<LocalMeeting>, String> {
        let mut meetings = Vec::new();
        for entry in fs::read_dir(&self.root)
            .map_err(|_| "Could not read private meeting storage.".to_string())?
        {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            let kind = match entry.file_type() {
                Ok(kind) if kind.is_dir() => kind,
                _ => continue,
            };
            let _ = kind;
            let id = entry.file_name().to_string_lossy().into_owned();
            if validate_uuid(&id).is_err() {
                continue;
            }
            if let Some(meeting) = self.read_meeting(&entry.path(), &id) {
                meetings.push(meeting);
            }
        }
        meetings.sort_by(|left, right| {
            right
                .created_at_ms
                .cmp(&left.created_at_ms)
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        Ok(meetings)
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<(), String> {
        let _update = METADATA_UPDATE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        validate_name(name)?;
        let path = self.existing_meeting_path(id)?;
        let mut metadata = read_metadata(&path, id)?;
        metadata.name = name.trim().to_owned();
        write_metadata(&path, &metadata)
    }

    pub fn mark_uploaded(&self, id: &str, origin: &str) -> Result<(), String> {
        let _update = METADATA_UPDATE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if origin.is_empty() || origin.len() > 2048 || origin.chars().any(char::is_control) {
            return Err("Uploaded meeting origin is invalid.".into());
        }
        let path = self.existing_meeting_path(id)?;
        let mut metadata = read_metadata(&path, id)?;
        metadata.uploaded_origin = Some(origin.to_owned());
        write_metadata(&path, &metadata)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let path = self.existing_meeting_path(id)?;
        fs::remove_dir_all(path).map_err(|_| "Could not remove saved meeting.".to_string())
    }

    fn existing_meeting_path(&self, id: &str) -> Result<PathBuf, String> {
        let path = self.meeting_path(id)?;
        let metadata =
            fs::symlink_metadata(&path).map_err(|_| "Saved meeting is unavailable.".to_string())?;
        if !metadata.file_type().is_dir() {
            return Err("Saved meeting is unavailable.".into());
        }
        Ok(path)
    }

    fn read_meeting(&self, path: &Path, id: &str) -> Option<LocalMeeting> {
        let meta = read_metadata(path, id);
        match (CaptureSpool::load_read_only(path), meta) {
            (Ok(Some(spool)), Ok(metadata)) => Some(LocalMeeting {
                session_id: id.to_owned(),
                name: metadata.name,
                created_at_ms: metadata.created_at_ms,
                state: match spool.state() {
                    DraftState::Recording => "recording",
                    DraftState::Interrupted => "interrupted",
                    DraftState::Ready => "ready",
                }
                .to_owned(),
                elapsed_seconds: spool.elapsed_seconds(),
                chunks: spool.chunks().to_vec(),
                uploaded_origin: metadata.uploaded_origin,
                error: None,
                recovered: spool.recovered(),
            }),
            (Ok(Some(spool)), Err(_)) => Some(error_meeting(
                id,
                spool.elapsed_seconds(),
                spool.chunks().to_vec(),
            )),
            (Err(_), Ok(metadata)) => Some(error_meeting_with_metadata(metadata, id)),
            (Err(_), Err(_)) => Some(error_meeting(id, 0.0, Vec::new())),
            (Ok(None), _) => None,
        }
    }

    fn migrate_legacy_draft(&self) -> Result<(), String> {
        if self.has_meeting_dirs()? {
            self.repair_missing_migration_metadata()?;
            return Ok(());
        }
        let legacy_manifest = self.root.join("capture-manifest.json");
        if !legacy_manifest.exists() {
            return Ok(());
        }
        let spool = CaptureSpool::load_read_only(&self.root)?
            .ok_or_else(|| "Could not recover the previous saved meeting.".to_string())?;
        let id = spool.session_id().to_owned();
        validate_uuid(&id)?;
        let backup = migration_backup(&self.root)?;
        if backup.exists() {
            return Err("A previous meeting migration needs recovery.".into());
        }
        fs::rename(&self.root, &backup)
            .map_err(|_| "Could not preserve the previous saved meeting.".to_string())?;
        if let Err(_) = fs::create_dir(&self.root).and_then(|_| {
            set_private_dir(&self.root).map_err(|_| std::io::Error::other("permissions"))
        }) {
            let _ = fs::rename(&backup, &self.root);
            return Err("Could not finish meeting storage migration.".into());
        }
        move_migration_backup(&self.root, &backup, &id)?;
        Ok(())
    }

    fn repair_missing_migration_metadata(&self) -> Result<(), String> {
        for entry in fs::read_dir(&self.root)
            .map_err(|_| "Could not read private meeting storage.".to_string())?
        {
            let entry = entry.map_err(|_| "Could not read private meeting storage.".to_string())?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if validate_uuid(&id).is_err()
                || !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                || entry.path().join(METADATA_NAME).exists()
            {
                continue;
            }
            // A damaged meeting must not block the healthy library.
            let Ok(Some(spool)) = CaptureSpool::load_read_only(entry.path()) else {
                continue;
            };
            if spool.session_id() != id {
                continue;
            }
            write_metadata(
                &entry.path(),
                &Metadata {
                    version: 1,
                    session_id: id,
                    name: "Recovered meeting".into(),
                    created_at_ms: now_ms(),
                    uploaded_origin: None,
                },
            )?;
        }
        Ok(())
    }

    fn has_meeting_dirs(&self) -> Result<bool, String> {
        for entry in fs::read_dir(&self.root)
            .map_err(|_| "Could not read private meeting storage.".to_string())?
        {
            let entry = entry.map_err(|_| "Could not read private meeting storage.".to_string())?;
            if validate_uuid(&entry.file_name().to_string_lossy()).is_ok()
                && entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

fn error_meeting(id: &str, elapsed_seconds: f64, chunks: Vec<ChunkInfo>) -> LocalMeeting {
    LocalMeeting {
        session_id: id.to_owned(),
        name: "Unavailable meeting".into(),
        created_at_ms: 0,
        state: "error".into(),
        elapsed_seconds,
        chunks,
        uploaded_origin: None,
        error: Some("Saved meeting data is corrupt or unavailable.".into()),
        recovered: false,
    }
}

fn error_meeting_with_metadata(metadata: Metadata, id: &str) -> LocalMeeting {
    LocalMeeting {
        session_id: id.to_owned(),
        name: metadata.name,
        created_at_ms: metadata.created_at_ms,
        state: "error".into(),
        elapsed_seconds: 0.0,
        chunks: Vec::new(),
        uploaded_origin: metadata.uploaded_origin,
        error: Some("Saved meeting data is corrupt or unavailable.".into()),
        recovered: false,
    }
}

fn read_metadata(path: &Path, id: &str) -> Result<Metadata, String> {
    let file_path = path.join(METADATA_NAME);
    let metadata = fs::symlink_metadata(&file_path)
        .map_err(|_| "Saved meeting details are unavailable.".to_string())?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_METADATA_BYTES {
        return Err("Saved meeting details are corrupt or oversized.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(file_path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|_| "Could not read saved meeting details.".to_string())?;
    let decoded: Metadata = serde_json::from_slice(&bytes)
        .map_err(|_| "Saved meeting details are corrupt.".to_string())?;
    if decoded.version != 1 || decoded.session_id != id || validate_name(&decoded.name).is_err() {
        return Err("Saved meeting details are corrupt.".into());
    }
    if decoded.uploaded_origin.as_ref().is_some_and(|origin| {
        origin.is_empty() || origin.len() > 2048 || origin.chars().any(char::is_control)
    }) {
        return Err("Saved meeting details are corrupt.".into());
    }
    Ok(decoded)
}

fn write_metadata(dir: &Path, metadata: &Metadata) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(metadata).map_err(|_| "Could not save meeting details.".to_string())?;
    if bytes.len() as u64 > MAX_METADATA_BYTES {
        return Err("Meeting details reached their size limit.".into());
    }
    let temp = dir.join("meeting.json.tmp");
    let final_path = dir.join(METADATA_NAME);
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temp)
        .map_err(|_| "Could not write private meeting details.".to_string())?;
    set_private_file(&temp)?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Could not save meeting details.".to_string())?;
    fs::rename(temp, final_path).map_err(|_| "Could not finalize meeting details.".to_string())
}

fn validate_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 255 || name.chars().any(char::is_control) {
        return Err("Meeting name must contain 1 to 255 printable characters.".into());
    }
    Ok(())
}

fn validate_uuid(value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    if bytes.len() != 36
        || [8, 13, 18, 23].iter().any(|index| bytes[*index] != b'-')
        || bytes
            .iter()
            .enumerate()
            .any(|(i, byte)| ![8, 13, 18, 23].contains(&i) && !byte.is_ascii_hexdigit())
    {
        return Err("Meeting ID must be a UUID.".into());
    }
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn migration_backup(root: &Path) -> Result<PathBuf, String> {
    let name = root
        .file_name()
        .ok_or_else(|| "Meeting storage path has no parent name.".to_string())?
        .to_string_lossy();
    Ok(root.with_file_name(format!(".{name}.meeting-migration")))
}

fn recover_migration(root: &Path) -> Result<(), String> {
    let backup = migration_backup(root)?;
    if !backup.exists() {
        return Ok(());
    }
    let backup_meta = fs::symlink_metadata(&backup)
        .map_err(|_| "Could not recover previous meeting migration.".to_string())?;
    if !backup_meta.file_type().is_dir() {
        return Err("Previous meeting migration is invalid.".into());
    }
    if !root.exists() {
        let spool = CaptureSpool::load_read_only(&backup)?
            .ok_or_else(|| "Could not recover previous meeting migration.".to_string())?;
        fs::create_dir(root)
            .map_err(|_| "Could not recover previous meeting migration.".to_string())?;
        set_private_dir(root)?;
        move_migration_backup(root, &backup, spool.session_id())?;
        return Ok(());
    }
    let has_root_manifest = root.join("capture-manifest.json").exists();
    let has_any_entries = fs::read_dir(root)
        .map_err(|_| "Could not inspect previous meeting migration.".to_string())?
        .next()
        .is_some();
    if has_root_manifest {
        return Err("Previous meeting migration conflicts with saved data.".into());
    }
    if !has_any_entries {
        let spool = CaptureSpool::load_read_only(&backup)?
            .ok_or_else(|| "Could not recover previous meeting migration.".to_string())?;
        move_migration_backup(root, &backup, spool.session_id())?;
    } else {
        return Err("Previous meeting migration conflicts with saved data.".into());
    }
    Ok(())
}

fn move_migration_backup(root: &Path, backup: &Path, id: &str) -> Result<(), String> {
    validate_uuid(id)?;
    let destination = root.join(id);
    if destination.exists() {
        return Err("Previous meeting migration conflicts with saved data.".into());
    }
    fs::rename(backup, destination)
        .map_err(|_| "Could not finish meeting storage migration.".to_string())?;
    let meeting_path = root.join(id);
    set_private_dir(&meeting_path)?;
    let spool = CaptureSpool::load_read_only(&meeting_path)?
        .ok_or_else(|| "Could not recover the previous saved meeting.".to_string())?;
    let metadata = Metadata {
        version: 1,
        session_id: id.to_owned(),
        name: "Recovered meeting".into(),
        created_at_ms: now_ms(),
        uploaded_origin: None,
    };
    if !meeting_path.join(METADATA_NAME).exists() {
        write_metadata(&meeting_path, &metadata)?;
    }
    let _ = spool;
    Ok(())
}

#[cfg(unix)]
fn set_private_dir(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Could not secure meeting storage.".into())
}
#[cfg(not(unix))]
fn set_private_dir(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| "Could not secure meeting details.".into())
}
#[cfg(not(unix))]
fn set_private_file(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::{lifecycle::Source, spool::CaptureSpool};
    use std::path::Path;
    use tempfile::TempDir;

    const ONE: &str = "1f2c83ab-4d6e-4a10-9f71-c11a3f4d2e80";
    const TWO: &str = "2f2c83ab-4d6e-4a10-9f71-c11a3f4d2e80";

    fn library(dir: &TempDir) -> MeetingLibrary {
        MeetingLibrary::open(dir.path().join("library")).unwrap()
    }

    #[test]
    fn meetings_persist_rename_upload_and_remove_independently() {
        let dir = TempDir::new().unwrap();
        let library = library(&dir);
        for (id, name) in [(ONE, "First"), (TWO, "Second")] {
            library.initialize(id, name).unwrap();
            CaptureSpool::create(
                library.meeting_path(id).unwrap(),
                id.into(),
                vec![Source::Microphone],
            )
            .unwrap();
        }
        library.rename(ONE, "Planning").unwrap();
        library
            .mark_uploaded(ONE, "https://savia.example/meetings/1")
            .unwrap();
        let reopened = MeetingLibrary::open(library.root().to_path_buf()).unwrap();
        let first = reopened
            .list()
            .unwrap()
            .into_iter()
            .find(|m| m.session_id == ONE)
            .unwrap();
        assert_eq!(first.name, "Planning");
        assert_eq!(
            first.uploaded_origin.as_deref(),
            Some("https://savia.example/meetings/1")
        );
        reopened.remove(ONE).unwrap();
        let remaining = reopened.list().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].session_id, TWO);
    }

    #[test]
    fn migrates_legacy_single_draft_without_losing_chunks() {
        let dir = TempDir::new().unwrap();
        let legacy = dir.path().join("library");
        let mut spool =
            CaptureSpool::create(&legacy, ONE.into(), vec![Source::Microphone]).unwrap();
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
        let migrated = MeetingLibrary::open(legacy.clone()).unwrap();
        let loaded = CaptureSpool::load_read_only(migrated.meeting_path(ONE).unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(loaded.read_chunk(Source::Microphone, 0).unwrap(), b"OggS");
        assert_eq!(migrated.list().unwrap()[0].name, "Recovered meeting");
        assert_eq!(migrated.root(), Path::new(&legacy));
    }

    #[test]
    fn resumes_migration_when_legacy_directory_was_moved_to_backup() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("library");
        let mut spool = CaptureSpool::create(&root, ONE.into(), vec![Source::System]).unwrap();
        spool
            .append_chunk(
                ChunkInfo {
                    source: Source::System,
                    sequence: 0,
                    start_seconds: 0.0,
                    duration_seconds: 1.0,
                    bytes: 4,
                    sample_rate: 48_000,
                },
                b"OggS",
            )
            .unwrap();
        let backup = migration_backup(&root).unwrap();
        fs::rename(&root, &backup).unwrap();
        fs::create_dir(&root).unwrap();
        let recovered = MeetingLibrary::open(root.clone()).unwrap();
        assert_eq!(recovered.list().unwrap()[0].session_id, ONE);
        let spool = CaptureSpool::load_read_only(recovered.meeting_path(ONE).unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(spool.read_chunk(Source::System, 0).unwrap(), b"OggS");
        assert!(!backup.exists());
    }

    #[test]
    fn repairs_metadata_if_migration_crashed_after_atomic_directory_move() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("library");
        let mut spool = CaptureSpool::create(&root, ONE.into(), vec![Source::System]).unwrap();
        spool
            .append_chunk(
                ChunkInfo {
                    source: Source::System,
                    sequence: 0,
                    start_seconds: 0.0,
                    duration_seconds: 1.0,
                    bytes: 4,
                    sample_rate: 48_000,
                },
                b"OggS",
            )
            .unwrap();
        let backup = migration_backup(&root).unwrap();
        fs::rename(&root, &backup).unwrap();
        fs::create_dir(&root).unwrap();
        fs::rename(&backup, root.join(ONE)).unwrap();

        let recovered = MeetingLibrary::open(root.clone()).unwrap();
        let rows = recovered.list().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Recovered meeting");
        let audio = CaptureSpool::load_read_only(recovered.meeting_path(ONE).unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(audio.read_chunk(Source::System, 0).unwrap(), b"OggS");
    }

    #[test]
    fn listing_does_not_mutate_live_recording_and_corruption_is_isolated() {
        let dir = TempDir::new().unwrap();
        let library = library(&dir);
        library.initialize(ONE, "Live").unwrap();
        let live = CaptureSpool::create(
            library.meeting_path(ONE).unwrap(),
            ONE.into(),
            vec![Source::Microphone],
        )
        .unwrap();
        library.initialize(TWO, "Damaged").unwrap();
        fs::write(
            library
                .meeting_path(TWO)
                .unwrap()
                .join("capture-manifest.json"),
            b"{",
        )
        .unwrap();
        let listed = library.list().unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(
            listed.iter().find(|m| m.session_id == ONE).unwrap().state,
            "recording"
        );
        assert!(
            !listed
                .iter()
                .find(|m| m.session_id == ONE)
                .unwrap()
                .recovered
        );
        assert_eq!(
            listed.iter().find(|m| m.session_id == TWO).unwrap().state,
            "error"
        );
        drop(live);
        let bytes = fs::read(
            library
                .meeting_path(ONE)
                .unwrap()
                .join("capture-manifest.json"),
        )
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(manifest["state"], "recording");
    }

    #[test]
    fn validates_ids_names_origins_and_rejects_symlink_meetings() {
        let dir = TempDir::new().unwrap();
        let library = library(&dir);
        assert!(library.meeting_path("../../etc").is_err());
        assert!(library.initialize(ONE, "\n").is_err());
        assert!(library.initialize(ONE, &"x".repeat(256)).is_err());
        library.initialize(ONE, "Safe").unwrap();
        assert!(library.mark_uploaded(ONE, &"x".repeat(2049)).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let other = dir.path().join("other");
            fs::create_dir(&other).unwrap();
            let link = library.root().join(TWO);
            symlink(other, &link).unwrap();
            assert!(library.meeting_path(TWO).is_err());
            assert!(library.remove(TWO).is_err());
        }
    }

    #[test]
    fn concurrent_rename_and_upload_preserve_both_metadata_fields() {
        let dir = TempDir::new().unwrap();
        let library = library(&dir);
        library.initialize(ONE, "Before").unwrap();
        CaptureSpool::create(
            library.meeting_path(ONE).unwrap(),
            ONE.into(),
            vec![Source::Microphone],
        )
        .unwrap();
        let rename_library = library.clone();
        let rename = std::thread::spawn(move || {
            for _ in 0..20 {
                rename_library.rename(ONE, "After").unwrap();
            }
        });
        for _ in 0..20 {
            library.mark_uploaded(ONE, "https://savia.example").unwrap();
        }
        rename.join().unwrap();
        let row = library.list().unwrap().remove(0);
        assert_eq!(row.name, "After");
        assert_eq!(
            row.uploaded_origin.as_deref(),
            Some("https://savia.example")
        );
    }

    #[test]
    fn corrupt_meeting_without_metadata_does_not_block_reopening() {
        let dir = TempDir::new().unwrap();
        let library = library(&dir);
        library.initialize(ONE, "Healthy").unwrap();
        CaptureSpool::create(
            library.meeting_path(ONE).unwrap(),
            ONE.into(),
            vec![Source::Microphone],
        )
        .unwrap();
        library.initialize(TWO, "Damaged").unwrap();
        fs::remove_file(library.meeting_path(TWO).unwrap().join(METADATA_NAME)).unwrap();
        fs::write(
            library
                .meeting_path(TWO)
                .unwrap()
                .join("capture-manifest.json"),
            b"{",
        )
        .unwrap();
        let reopened = MeetingLibrary::open(library.root().to_path_buf()).unwrap();
        assert_eq!(reopened.list().unwrap().len(), 2);
        assert!(reopened
            .list()
            .unwrap()
            .iter()
            .find(|row| row.session_id == ONE)
            .unwrap()
            .error
            .is_none());
    }

    #[test]
    fn metadata_size_and_corrupt_metadata_remain_a_local_error() {
        let dir = TempDir::new().unwrap();
        let library = library(&dir);
        library.initialize(ONE, "Valid").unwrap();
        CaptureSpool::create(
            library.meeting_path(ONE).unwrap(),
            ONE.into(),
            vec![Source::Microphone],
        )
        .unwrap();
        fs::write(
            library.meeting_path(ONE).unwrap().join(METADATA_NAME),
            vec![b'x'; (MAX_METADATA_BYTES + 1) as usize],
        )
        .unwrap();
        let rows = library.list().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].state, "error");
    }
}
