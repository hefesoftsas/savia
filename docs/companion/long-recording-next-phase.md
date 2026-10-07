# Recording sessions: phase 2

Status: implementation under validation, 2026-10-05. Preview installers remain
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
The scheduled Worker visits up to 32 queue entries per invocation, with at most
four operations running concurrently in that invocation. Preview and production
render a once-per-minute cron trigger. A conditional-write checkpoint in R2
advances the scan after each claimed wave of at most four entries. Later invocations
continue after its last key and wrap at the end. Only a wave that can start is
reserved; the time budget never strands the tail of a larger reserved batch.
This reaches entries beyond the first 1,000 and gives
each session one operation per visit, instead of letting the first long recording
consume every step while later sessions wait. Small queues can complete multiple
sweeps within one invocation. Concurrent scans use compare-and-swap to advance
the checkpoint.

The checkpoint is a scan position, not a completion acknowledgment. Entries remain
until their processing run terminates. A crash, active lease, temporary read error,
or elapsed dispatch budget leaves the entry available on a later sweep. New entries
inserted behind the checkpoint are also visited on the next sweep. A batch stops
reserving new waves after its 45-second dispatch budget and completes the current
wave; this budget does not abort a provider request. One damaged entry does not stop the batch.
Each cron emits a `companion_session_batch` log with candidate, attempted-operation,
and dispatch-failure counts, without owners, transcripts, or provider credentials.

This provides bounded parallel processing and rotating service between sessions,
not tenant quotas, global provider rate limiting, autoscaling, or a completion-time
SLA. Four is a per-invocation concurrency limit; overlapping invocations can run
more calls across distinct sessions. At the default batch size a stable queue of
1,024 entries takes at least 32 cron invocations per sweep, and slow providers can
make it longer. Large sustained workloads still need capacity sizing and a dedicated
queue/consumer tier. Provider failures remain visible in session status and must
not be inferred solely from dispatch-failure logs.

Each operation acquires an R2 conditional-write lease, checks the
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

Transcription first tries automatic language detection (`auto`, the default for
new runs). The processing request accepts an optional `language`: `auto` or a
two-letter code (for example `en`, `pt`, `fr`, `de`, `it`). An explicit user
choice is stored on the job, used for every chunk, and always wins over
detection; the summary follows the transcript language. Switching language
after transcripts exist requires explicit `retranscribe` consent, replaces
saved transcripts and summaries, and may be billed again. Short audio-file
notes accept the same `language`/`retranscribe` options.

## Session names

New sessions start with a user-editable name that defaults to the local
day and hour (for example `Recording 2026-10-06 09:47`), never a bare
recording identifier. Desktop and mobile capture both offer the name for
editing before upload. Any owner with `recordings:upload` can rename a
session later with `PATCH /v1/companion/sessions/{id}` (`{name: 1..255 chars}`;
see the generated OpenAPI/Scalar Companion group for the exact contract);
admin and mobile review screens expose a rename action.

When summary processing completes, a session whose name is still a generic
default (`Recording <hex>`, localized variants, or `Recording.m4a`) is
renamed automatically: the summary model returns a concise `title` (1..80
chars, in the meeting language) in the same provider call, and the worker
adopts it. If the model returns no usable title, the worker falls back to a
UTC day-hour name (`Recording YYYY-MM-DD HH:mm`) derived from creation time.
A user-chosen name is never overwritten.

## Review and questions

Library listing returns metadata; individual session reads retrieve saved transcripts
and notes, keeping long recordings from expanding every list response.

Before upload, the desktop app can explicitly preview each source in the current
stopped, interrupted, or recovered draft. It reads completed Ogg/Opus chunks from the private
native spool, validates them, and remuxes them in sequence into a local preview
capped at 64 MiB per source. This path requires no Savia API connection, key,
upload permission, upload consent, or provider request; it does not upload audio.
Starting a new recording or discarding the draft clears its previews. The app
releases temporary preview URLs when replacing a preview and when the view is
closed.

Recordings → Recording sessions shows one session with combined playback,
processing state, partial transcripts, summary and questions. When a session has
more than one Ogg source, the review screen offers a single “combined call”
player: it loads each source as one chained file and plays microphone and
system audio together in lockstep, so a meeting is heard as one conversation.
Per-source full-audio players and downloads remain below for isolated review.
`GET /v1/companion/sessions/{id}/audio?source=` returns one source as a single
chained Ogg file for listening and download. Each validated complete logical
stream gets a distinct serial number and recomputed page checksums; codec packets,
granule positions and pre-skip remain intact. The endpoint requires a finalized
session with Ogg-only segments (desktop captures) and is capped at 64 MB.
The web review UI allows up to 60 seconds for each full-source audio download;
individual segment requests keep the standard API timeout.
Sessions with M4A segments keep per-segment playback only.
A session with saved transcript segments can answer questions before all work is
complete. Answers include the source/sequence/time references sent as evidence.
For long transcripts, bounded lexical retrieval selects whole excerpts; the UI
explicitly identifies partial evidence. It is not a guarantee of exhaustive search
or speaker identification. Verify answers against the transcript and audio.

Existing audio-file imports and short recording APIs remain available under the
Audio files view. Summaries and answers never create business records or send
external messages automatically.

## Session deletion

Any owner with `recordings:delete` can permanently delete a session with
`DELETE /v1/companion/sessions/{id}` (see the generated OpenAPI/Scalar
Companion group for the exact contract); the admin review screen exposes a
delete action with confirmation. Deletion removes the manifest, every audio
chunk and the pending job-schedule entry for that owner/workspace namespace;
cross-workspace deletes return 404. It does not discard the local Companion
draft or revoke provider usage already billed.

## Validation and limits

Automated integration tests cover a synthetic hour consisting of 120 real AAC
segments, immutable retry recovery, pagination beyond 1,000 stored objects,
workspace isolation, durable leases, cancellation and upload-to-question routing.
Scheduler tests exercise 1,105 persisted queue entries, checkpoint continuity across
new repository instances, conditional concurrent claims, deleted cursor keys,
wraparound, damaged-entry isolation, and bounded parallel dispatch. A two-session
integration verifies concurrent transcription and persisted summaries using the
R2 test binding and a fake provider. These are automated correctness checks, not a
production load benchmark.
Frontend tests exercise separate retry consent, progress, clearing stale answers,
combined-call playback of both sources, and session deletion with list removal.
These checks do not substitute for microphone/loopback recordings on physical
Windows/macOS/Android/iOS devices, Bluetooth changes, mobile force termination,
or a paid hour-long provider qualification. Record those results using
[the validation protocol](validation.md).

See [mobile capture](mobile.md), [download publication](downloads.md), and
[the existing epics](epics.md). OpenRouter's
[STT documentation](https://openrouter.ai/docs/guides/overview/multimodal/stt),
checked on 2026-10-03, distinguishes upload size from provider processing time.
