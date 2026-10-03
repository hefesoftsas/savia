# Recording sessions: phase 2

Status: implementation under validation, 2026-10-03. Preview installers remain
experimental; physical-device hour-long qualification is separate from automated
synthetic validation.

## Capture and recovery

Desktop microphone and system sources remain separate. Continuous native streams
feed bounded 30-second PCM segments into local Ogg/Opus encoders; each segment is
limited to 8 MiB of raw PCM and 512 KiB encoded. A session stops at 3,600 seconds
and contains at most 120 segments per source (240 total). Timeline offsets preserve
gaps instead of silently joining missing audio. Device interruption is reported.

Desktop keeps one private pending draft in the native app data directory. Its
manifest is written atomically after completed audio segments. Closing preserves
completed audio; reopening exposes a recovered draft and never restarts recording
automatically. Discard removes that local draft, not uploaded backend audio.
Credentials are kept in memory, never in the capture spool. An interrupted segment
that has not been committed may be lost; completed segments remain recoverable.

Mobile records AAC-LC mono 24 kHz at 32 kbps for up to an hour with the app open.
Its completed M4A file is split into independently playable segments before upload.
Background/locked-screen capture remains outside this increment: the foreground
capture lifecycle still stops on application interruption.

## Upload and workspace isolation

A recording session has a stable UUID, owner, selected workspace, sources and an
immutable timeline. Upload requires consent and `recordings:upload`. Create is
idempotent for identical metadata; clients compare saved segment identities and
send only pending audio. Each independently validated Ogg or M4A segment has an
actual byte count, SHA-256, source, sequence, start and duration. Conflicting retries
are rejected. Finalization checks declared counts, contiguous sequences and
non-overlap within each source. M4A timelines tolerate at most 100 ms of AAC
container padding at a boundary; Ogg tolerance is 1 ms. Declared session duration
never exceeds 3,600 seconds. Incomplete uploads cannot be processed.

R2 is authoritative for session manifests, immutable audio and job results.
Owner/workspace namespaces and scopes apply to every read and write. No public
audio URL or browser persistence is introduced. See the generated OpenAPI/Scalar
Companion group for exact request and response contracts.

## Durable transcription and summaries

Generating notes requires separate provider consent and `recordings:process`.
The existing scheduled Worker runtime processes up to eight bounded operations
per invocation. Each operation acquires an R2 conditional-write lease, checks the
owner's current active workspace membership and resolves backend provider settings.
No bearer token or provider key is stored in a job. Lease ownership prevents
concurrent workers from submitting the same operation.

Transcripts persist after each segment. Summaries reduce bounded transcript groups
and preserve structured decisions, actions and open questions before final output.
Progress survives browser closure and backend restarts. Cancellation stops future
submissions, preserves saved results and does not undo a request already submitted.
A provider timeout or crash after submission enters `needs_attention`; the system
does not automatically repeat a possibly billable request. A new explicit retry
requires renewed consent and acknowledgment of possible additional charges.
Each processing run has its own queue identity so cleanup of an older run cannot
remove a later retry.

## Review and questions

Library listing returns metadata; individual session reads retrieve saved transcripts
and notes, keeping long recordings from expanding every list response.

Recordings → Recording sessions shows one session with source-aware playback,
processing state, partial transcripts, summary and questions. Audio plays by
segment in sequence within the selected source; visible offsets preserve gaps.
A session with saved transcript segments can answer questions before all work is
complete. Answers include the source/sequence/time references sent as evidence.
For long transcripts, bounded lexical retrieval selects whole excerpts; the UI
explicitly identifies partial evidence. It is not a guarantee of exhaustive search
or speaker identification. Verify answers against the transcript and audio.

Existing audio-file imports and short recording APIs remain available under the
Audio files view. Summaries and answers never create business records or send
external messages automatically.

## Validation and limits

Automated integration tests cover a synthetic hour consisting of 120 real AAC
segments, immutable retry recovery, pagination beyond 1,000 stored objects,
workspace isolation, durable leases, cancellation and upload-to-question routing.
Frontend tests exercise separate retry consent, progress and clearing stale answers.
These checks do not substitute for microphone/loopback recordings on physical
Windows/macOS/Android/iOS devices, Bluetooth changes, mobile force termination,
or a paid hour-long provider qualification. Record those results using
[the validation protocol](validation.md).

See [mobile capture](mobile.md), [download publication](downloads.md), and
[the existing epics](epics.md). OpenRouter's
[STT documentation](https://openrouter.ai/docs/guides/overview/multimodal/stt),
checked on 2026-10-03, distinguishes upload size from provider processing time.
