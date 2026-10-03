# Long-recording next phase — scope proposal

Status: candidate scope awaiting clarification of the user's “phase 2”.
The requested maximum capture duration is one hour. This proposal does not
represent implemented desktop capture or background processing.

## Existing constraints

Mobile captures AAC to a temporary file and can extend its foreground timer.
Desktop buffers raw PCM, then allocates float/resampling/encoded buffers on stop.
Its source save route accepts only a short Ogg object; extending its timer alone
would leave memory, container, upload and provider constraints unresolved.

## Proposed implementation sequence

1. Capture desktop source tracks into bounded, independently decodable segments.
   Keep microphone and system tracks separate, align them to a monotonic timeline,
   cap the session at 3,600 seconds, and delete temporary PCM after each segment
   is encoded. A one-hour source must not become a single in-memory PCM buffer.
2. Add a backend-owned session manifest and authenticated, idempotent segment
   ingestion. Validate owner, workspace, scope, actual duration, size, sequence,
   and checksum. Report partial uploads explicitly; retain existing samples.
3. Persist processing jobs, leases and results on the backend. Process bounded
   segments with explicit provider consent, bounded concurrency and cancellation.
   Treat an ambiguous billed timeout as requiring reconciliation, not an automatic
   retry. Generate a summary only from persisted transcript versions.
4. Expose one recording in the library, its progress, gaps and recoverable failures.
   Aggregate transcript evidence on the session timeline for summaries and Q&A.
   Never treat unfinished segments as a complete transcript.
5. Validate a synthetic hour on each target platform, process restart recovery,
   interrupted upload, duplicate requests, revoked credentials, partial provider
   failure, memory bounds, playback and evidence-grounded answers before release.

Native temporary capture files are capture artifacts, not an offline application
database. The backend remains the source of truth for recordings and job state.
Background/locked-screen mobile capture needs explicit platform lifecycle and
permission work; it is not implied by increasing the foreground timer.

See CMP-06 and CMP-08 in [the existing epics](epics.md). OpenRouter's
[STT documentation](https://openrouter.ai/docs/guides/overview/multimodal/stt),
checked on 2026-10-03, distinguishes upload size from provider processing time
and recommends splitting requests that exceed upstream processing timeouts.
