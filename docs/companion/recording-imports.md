# Import recordings

The Recordings page accepts audio from your computer and from connected Google
Drive, OneDrive Personal, and OneDrive for Business accounts. Imported files remain
private to the current account and are stored in Savia; edits to the source cloud
file do not synchronize with the saved recording.

1. Open **Recordings** and choose **Upload recording**.
2. Use **Local disk** to select a file, or choose a connected drive, search by
   filename, and choose **Import** beside the desired audio file.
3. Listen to the saved recording or download the original audio.
4. To generate a transcript and meeting notes, grant processing consent and choose
   **Generate summary**. Uploading alone does not send audio to the AI provider.

## Access and privacy

All active tenant members can use **Recordings**, regardless of role. Platform
administrators can also use it. Users without an active membership cannot access
the feature. Audio, transcripts, notes, and connected-drive imports belong to the
authenticated user; tenant membership, including an administrator role, does not
grant access to another member's recordings.

The deployment must still enable `COMPANION_ENABLED=true`. Preview enables it;
production remains disabled until explicitly configured.

## Limits and connections

- Supported imports: MP3, WAV, M4A, and OGG/Opus (including `.opus` and `.oga`
  extensions), up to **50 MB**
  (50,000,000 bytes) per file. Both local uploads and cloud downloads enforce the
  actual byte limit on the server. Invalid audio is rejected.
- Imported recordings have no 60-second duration limit. Duration appears when it
  can be determined from the audio; otherwise the original file remains available
  for playback and download.
- The short capture/transcription validation endpoints used by Savia Companion
  keep their existing limits. Imports use a separate binary upload route so they
  do not need base64 encoding in the browser.
- Cloud choices require both an enabled provider and a connected personal account.
  Configure these accounts in **Personal integrations**. Sign-in with Google or
  Microsoft alone does not grant file access. A disconnected or expired connection
  must be connected again before import.
- File access and credentials remain on the server. The server resolves the
  authenticated user's connection and reads the selected file identifier; the
  browser never submits a download URL or a provider token.
- Transcription depends on the configured OpenRouter model/provider's formats,
  payload limits, and timeout. Saving a 50 MB file does not guarantee that every
  transcription provider accepts it. A processing failure preserves the saved
  audio and any successfully saved transcript. Processing is never automatically
  retried.

## API

The generated OpenAPI reference documents the binary upload and cloud import
endpoints, together with the existing recording list, audio download, deletion,
and consented notes endpoints. Recording metadata includes the original filename,
origin, audio format, byte count, and nullable duration for imported files.
