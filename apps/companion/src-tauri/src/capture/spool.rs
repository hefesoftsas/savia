//! Private, crash-recoverable storage for independently decodable capture chunks.
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::{codec::MAX_OGG_BYTES, lifecycle::Source};

pub const MAX_SESSION_SECONDS: f64 = 3_600.0;
pub const MAX_CHUNKS_PER_SOURCE: usize = 120;
pub const NOMINAL_SEGMENT_SECONDS: f64 = 30.0;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MANIFEST_NAME: &str = "capture-manifest.json";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkInfo {
    pub source: Source,
    pub sequence: u16,
    pub start_seconds: f64,
    pub duration_seconds: f64,
    pub bytes: usize,
    pub sample_rate: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u8,
    session_id: String,
    state: DraftState,
    sources: Vec<Source>,
    elapsed_seconds: f64,
    chunks: Vec<ChunkInfo>,
    checksums: Vec<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DraftState {
    Recording,
    Interrupted,
    Ready,
}

#[derive(Clone, Debug)]
pub struct CaptureSpool {
    root: PathBuf,
    manifest: Manifest,
    recovered: bool,
}

impl CaptureSpool {
    /// Load the only pending draft, marking a previously recording session interrupted.
    pub fn load(root: impl AsRef<Path>) -> Result<Option<Self>, String> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(&root)
            .map_err(|_| "Could not prepare private capture storage.".to_string())?;
        set_private_dir(&root)?;
        let path = root.join(MANIFEST_NAME);
        if !path.exists() {
            return Ok(None);
        }
        let metadata = fs::metadata(&path)
            .map_err(|_| "Could not inspect saved capture state.".to_string())?;
        if metadata.len() > MAX_MANIFEST_BYTES {
            return Err("Saved capture state is corrupt or oversized.".into());
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        File::open(&path)
            .and_then(|mut file| file.read_to_end(&mut bytes))
            .map_err(|_| "Could not read saved capture state.".to_string())?;
        let mut manifest: Manifest = serde_json::from_slice(&bytes)
            .map_err(|_| "Saved capture state is corrupt.".to_string())?;
        validate_manifest(&manifest)?;
        let recovered = true;
        if manifest.state == DraftState::Recording {
            manifest.state = DraftState::Interrupted;
            persist_manifest(&root, &manifest)?;
        }
        Ok(Some(Self {
            root,
            manifest,
            recovered,
        }))
    }

    pub fn create(
        root: impl AsRef<Path>,
        session_id: String,
        sources: Vec<Source>,
    ) -> Result<Self, String> {
        validate_uuid(&session_id)?;
        if sources.is_empty()
            || sources
                .iter()
                .any(|source| sources.iter().filter(|s| *s == source).count() > 1)
        {
            return Err("Select one or more unique capture sources.".into());
        }
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(&root)
            .map_err(|_| "Could not prepare private capture storage.".to_string())?;
        set_private_dir(&root)?;
        if root.join(MANIFEST_NAME).exists() {
            return Err(
                "A saved capture draft must be discarded before starting another recording.".into(),
            );
        }
        let manifest = Manifest {
            version: 1,
            session_id,
            state: DraftState::Recording,
            sources,
            elapsed_seconds: 0.0,
            chunks: Vec::new(),
            checksums: Vec::new(),
        };
        persist_manifest(&root, &manifest)?;
        Ok(Self {
            root,
            manifest,
            recovered: false,
        })
    }

    pub fn session_id(&self) -> &str {
        &self.manifest.session_id
    }
    pub fn state(&self) -> DraftState {
        self.manifest.state
    }
    pub fn recovered(&self) -> bool {
        self.recovered
    }
    pub fn elapsed_seconds(&self) -> f64 {
        self.manifest.elapsed_seconds
    }
    pub fn chunks(&self) -> &[ChunkInfo] {
        &self.manifest.chunks
    }
    pub fn chunks_for(&self, source: Source) -> Vec<ChunkInfo> {
        self.manifest
            .chunks
            .iter()
            .filter(|c| c.source == source)
            .cloned()
            .collect()
    }

    pub fn append_chunk(&mut self, info: ChunkInfo, ogg: &[u8]) -> Result<(), String> {
        if self.manifest.state != DraftState::Recording {
            return Err("Capture is no longer recording.".into());
        }
        if !self.manifest.sources.contains(&info.source)
            || info.sequence as usize >= MAX_CHUNKS_PER_SOURCE
            || ogg.is_empty()
            || ogg.len() > MAX_OGG_BYTES
            || info.bytes != ogg.len()
            || !(8_000..=96_000).contains(&info.sample_rate)
            || !info.start_seconds.is_finite()
            || !info.duration_seconds.is_finite()
            || info.start_seconds < 0.0
            || info.duration_seconds <= 0.0
            || info.duration_seconds > 60.001
        {
            return Err("Captured segment metadata or size is invalid.".into());
        }
        let count = self
            .manifest
            .chunks
            .iter()
            .filter(|chunk| chunk.source == info.source)
            .count();
        if usize::from(info.sequence) != count {
            return Err("Captured segment sequence is invalid.".into());
        }
        let end = info.start_seconds + info.duration_seconds;
        if end > MAX_SESSION_SECONDS + 0.001 || self.manifest.elapsed_seconds > MAX_SESSION_SECONDS
        {
            return Err("Capture reached the one-hour duration limit.".into());
        }
        if self.manifest.chunks.iter().any(|chunk| {
            chunk.source == info.source
                && (chunk.start_seconds + chunk.duration_seconds > info.start_seconds + 0.001)
        }) {
            return Err("Captured segment overlaps an earlier segment.".into());
        }
        let filename = chunk_filename(info.source, info.sequence);
        let final_path = self.root.join(filename);
        let temp_path = self.root.join(format!(
            "{}.tmp",
            final_path.file_name().unwrap().to_string_lossy()
        ));
        write_atomic_file(&temp_path, &final_path, ogg)?;
        self.manifest.elapsed_seconds = self.manifest.elapsed_seconds.max(end);
        self.manifest.chunks.push(info);
        self.manifest.checksums.push(checksum(ogg));
        if let Err(error) = persist_manifest(&self.root, &self.manifest) {
            self.manifest.chunks.pop();
            self.manifest.checksums.pop();
            let _ = fs::remove_file(final_path);
            return Err(error);
        }
        Ok(())
    }

    pub fn update_elapsed(&mut self, elapsed: f64) -> Result<(), String> {
        if !elapsed.is_finite()
            || elapsed + 0.001 < self.manifest.elapsed_seconds
            || elapsed > MAX_SESSION_SECONDS + 0.001
        {
            return Err("Capture timeline is invalid or exceeds one hour.".into());
        }
        self.manifest.elapsed_seconds = elapsed
            .max(self.manifest.elapsed_seconds)
            .min(MAX_SESSION_SECONDS);
        persist_manifest(&self.root, &self.manifest)
    }

    pub fn stop(&mut self, elapsed: f64, interrupted: bool) -> Result<(), String> {
        self.update_elapsed(elapsed)?;
        self.manifest.state = if interrupted {
            DraftState::Interrupted
        } else {
            DraftState::Ready
        };
        persist_manifest(&self.root, &self.manifest)
    }

    pub fn read_chunk(&self, source: Source, sequence: u16) -> Result<Vec<u8>, String> {
        let info = self
            .manifest
            .chunks
            .iter()
            .find(|chunk| chunk.source == source && chunk.sequence == sequence)
            .ok_or_else(|| "Captured segment is unavailable.".to_string())?;
        let path = self.root.join(chunk_filename(source, sequence));
        let metadata = fs::metadata(&path)
            .map_err(|_| "Captured segment is unavailable or corrupt.".to_string())?;
        if metadata.len() != info.bytes as u64 || metadata.len() > MAX_OGG_BYTES as u64 {
            return Err("Captured segment is corrupt.".into());
        }
        let bytes = fs::read(path).map_err(|_| "Could not read captured segment.".to_string())?;
        let index = self
            .manifest
            .chunks
            .iter()
            .position(|chunk| chunk.source == source && chunk.sequence == sequence)
            .unwrap();
        if checksum(&bytes) != self.manifest.checksums[index] {
            return Err("Captured segment is corrupt.".into());
        }
        Ok(bytes)
    }

    pub fn discard(&self) -> Result<(), String> {
        discard_root(&self.root)
    }
}

pub fn discard_root(root: impl AsRef<Path>) -> Result<(), String> {
    for entry in fs::read_dir(root).map_err(|_| "Could not discard saved capture.".to_string())? {
        let entry = entry.map_err(|_| "Could not discard saved capture.".to_string())?;
        let kind = entry
            .file_type()
            .map_err(|_| "Could not discard saved capture.".to_string())?;
        if kind.is_file() {
            fs::remove_file(entry.path())
                .map_err(|_| "Could not discard saved capture.".to_string())?;
        }
    }
    Ok(())
}

fn chunk_filename(source: Source, sequence: u16) -> String {
    let source = match source {
        Source::Microphone => "microphone",
        Source::System => "system",
    };
    format!("{source}-{sequence:03}.ogg")
}

fn validate_manifest(manifest: &Manifest) -> Result<(), String> {
    validate_uuid(&manifest.session_id)?;
    if manifest.version != 1
        || manifest.sources.is_empty()
        || manifest.chunks.len() > MAX_CHUNKS_PER_SOURCE * 2
        || manifest.checksums.len() != manifest.chunks.len()
        || !manifest.elapsed_seconds.is_finite()
        || !(0.0..=MAX_SESSION_SECONDS + 0.001).contains(&manifest.elapsed_seconds)
    {
        return Err("Saved capture state is corrupt.".into());
    }
    let mut previous = [0usize; 2];
    let mut source_ends = [0.0f64; 2];
    let mut end = 0.0f64;
    for chunk in &manifest.chunks {
        let index = match chunk.source {
            Source::Microphone => 0,
            Source::System => 1,
        };
        if !manifest.sources.contains(&chunk.source)
            || previous[index] >= MAX_CHUNKS_PER_SOURCE
            || usize::from(chunk.sequence) != previous[index]
            || chunk.bytes == 0
            || chunk.bytes > MAX_OGG_BYTES
            || chunk.duration_seconds <= 0.0
            || chunk.duration_seconds > 60.001
            || !chunk.duration_seconds.is_finite()
            || !chunk.start_seconds.is_finite()
            || chunk.start_seconds < source_ends[index] - 0.001
            || chunk.start_seconds < 0.0
            || !(8_000..=96_000).contains(&chunk.sample_rate)
            || chunk.start_seconds + chunk.duration_seconds > MAX_SESSION_SECONDS + 0.001
        {
            return Err("Saved capture state is corrupt.".into());
        }
        previous[index] += 1;
        source_ends[index] = chunk.start_seconds + chunk.duration_seconds;
        end = end.max(source_ends[index]);
    }
    if end > manifest.elapsed_seconds + 0.001 {
        return Err("Saved capture state is corrupt.".into());
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
            .any(|(i, b)| ![8, 13, 18, 23].contains(&i) && !b.is_ascii_hexdigit())
    {
        return Err("Capture session ID must be a UUID.".into());
    }
    Ok(())
}

fn persist_manifest(root: &Path, manifest: &Manifest) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(manifest).map_err(|_| "Could not save capture state.".to_string())?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("Capture state reached its size limit.".into());
    }
    let temp = root.join("capture-manifest.json.tmp");
    let final_path = root.join(MANIFEST_NAME);
    write_atomic_file(&temp, &final_path, &bytes)
}

fn checksum(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

fn write_atomic_file(temp: &Path, final_path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(temp)
        .map_err(|_| "Could not write private capture storage.".to_string())?;
    set_private_file(temp)?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Could not save captured audio.".to_string())?;
    fs::rename(temp, final_path).map_err(|_| "Could not finalize captured audio.".to_string())?;
    Ok(())
}

#[cfg(unix)]
fn set_private_dir(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Could not secure capture storage.".into())
}
#[cfg(not(unix))]
fn set_private_dir(_: &Path) -> Result<(), String> {
    Ok(())
}
#[cfg(unix)]
fn set_private_file(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| "Could not secure captured audio.".into())
}
#[cfg(not(unix))]
fn set_private_file(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SESSION: &str = "1f2c83ab-4d6e-4a10-9f71-c11a3f4d2e80";
    fn info(source: Source, sequence: u16, start_seconds: f64, duration_seconds: f64) -> ChunkInfo {
        ChunkInfo {
            source,
            sequence,
            start_seconds,
            duration_seconds,
            bytes: 4,
            sample_rate: 48_000,
        }
    }
    fn spool(dir: &TempDir) -> CaptureSpool {
        CaptureSpool::create(dir.path(), SESSION.into(), vec![Source::Microphone]).unwrap()
    }

    #[test]
    fn records_independent_rollover_chunks_with_contiguous_sequences() {
        let dir = TempDir::new().unwrap();
        let mut spool = spool(&dir);
        spool
            .append_chunk(info(Source::Microphone, 0, 0.0, 30.0), b"OggS")
            .unwrap();
        spool
            .append_chunk(info(Source::Microphone, 1, 30.0, 30.0), b"OggS")
            .unwrap();
        assert_eq!(spool.chunks_for(Source::Microphone).len(), 2);
        assert_eq!(spool.read_chunk(Source::Microphone, 1).unwrap(), b"OggS");
        assert!(spool
            .append_chunk(info(Source::Microphone, 3, 60.0, 30.0), b"OggS")
            .is_err());
    }

    #[test]
    fn accepts_exact_hour_boundary_and_rejects_audio_past_tolerance() {
        let dir = TempDir::new().unwrap();
        let mut spool = spool(&dir);
        spool
            .append_chunk(info(Source::Microphone, 0, 3_570.0, 30.0), b"OggS")
            .unwrap();
        assert!(spool
            .append_chunk(info(Source::Microphone, 1, 3_600.0, 0.01), b"OggS")
            .is_err());
    }

    #[test]
    fn reload_marks_open_draft_interrupted_and_preserves_finalized_chunks() {
        let dir = TempDir::new().unwrap();
        let mut active = spool(&dir);
        active
            .append_chunk(info(Source::Microphone, 0, 0.0, 30.0), b"OggS")
            .unwrap();
        let recovered = CaptureSpool::load(dir.path()).unwrap().unwrap();
        assert_eq!(recovered.state(), DraftState::Interrupted);
        assert!(recovered.recovered());
        assert_eq!(recovered.session_id(), SESSION);
        assert_eq!(
            recovered.read_chunk(Source::Microphone, 0).unwrap(),
            b"OggS"
        );
    }

    #[test]
    fn rejects_corrupt_manifest_and_missing_or_wrong_sized_chunk() {
        let dir = TempDir::new().unwrap();
        let mut active = spool(&dir);
        active
            .append_chunk(info(Source::Microphone, 0, 0.0, 30.0), b"OggS")
            .unwrap();
        fs::write(dir.path().join("microphone-000.ogg"), b"bad").unwrap();
        assert!(active.read_chunk(Source::Microphone, 0).is_err());
        fs::write(dir.path().join(MANIFEST_NAME), b"{").unwrap();
        assert!(CaptureSpool::load(dir.path()).is_err());
    }

    #[test]
    fn interrupted_manifest_replacement_keeps_the_last_atomic_version() {
        let dir = TempDir::new().unwrap();
        let mut active = spool(&dir);
        active
            .append_chunk(info(Source::Microphone, 0, 0.0, 30.0), b"OggS")
            .unwrap();
        fs::write(dir.path().join("capture-manifest.json.tmp"), b"partial").unwrap();
        let recovered = CaptureSpool::load(dir.path()).unwrap().unwrap();
        assert_eq!(recovered.chunks().len(), 1);
        assert_eq!(
            recovered.read_chunk(Source::Microphone, 0).unwrap(),
            b"OggS"
        );
    }

    #[test]
    fn failed_duplicate_append_does_not_replace_an_existing_chunk() {
        let dir = TempDir::new().unwrap();
        let mut active = spool(&dir);
        active
            .append_chunk(info(Source::Microphone, 0, 0.0, 30.0), b"OggS")
            .unwrap();
        assert!(active
            .append_chunk(info(Source::Microphone, 0, 0.0, 30.0), b"FAIL")
            .is_err());
        assert_eq!(active.read_chunk(Source::Microphone, 0).unwrap(), b"OggS");
    }

    #[test]
    fn discard_removes_draft_and_stopped_draft_rejects_more_chunks() {
        let dir = TempDir::new().unwrap();
        let mut active = spool(&dir);
        active
            .append_chunk(info(Source::Microphone, 0, 0.0, 30.0), b"OggS")
            .unwrap();
        active.stop(30.0, false).unwrap();
        assert!(active
            .append_chunk(info(Source::Microphone, 1, 30.0, 30.0), b"OggS")
            .is_err());
        active.discard().unwrap();
        assert!(CaptureSpool::load(dir.path()).unwrap().is_none());
    }
}
