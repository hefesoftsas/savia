# Savia Companion validation application

Owner: Savia platform maintainers. Reviewed: 2026-10-01.

A Tauri desktop validation application for short microphone/system audio samples,
connected to Savia's opt-in OpenRouter processing adapter. Sessions are limited to
60 seconds, 8 MiB temporary PCM and 512 KiB compressed audio per source. This is an implementation increment, not a
qualified meeting recorder for long or confidential meetings.

See the [implementation status](../../docs/companion/implementation-status.md),
[epic backlog](../../docs/companion/epics.md),
[architecture](../../docs/companion/architecture.md), and
[validation protocol](../../docs/companion/validation.md).

## Prerequisites

Use the repository-pinned pnpm and Node.js 22 or later. Install the stable Rust
build toolchain and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your platform. macOS capture needs macOS 14.2+ and Xcode command-line tools
with a SDK that includes CoreAudio process taps; Windows targets Windows 11 x64
with the Microsoft C++ build tools. macOS signing/permission behavior and actual
Windows capture still needs real-device qualification coverage.

The validation machine used an isolated Rust installation under
`artifacts/toolchain`; it is ignored and is not required on another developer's
machine. No Rust installation or permission settings were changed globally.

## Run and build

From the monorepo root:

```sh
pnpm install
pnpm --filter @savia/companion desktop:dev
pnpm --filter @savia/companion desktop:build
```

`desktop:dev` runs Vite on **5181**, independently of Savia admin on 5173. The
application only records after a user clicks Start recording. Choose sources,
start, stop, then inspect the capture state. Discard before creating another sample.
Normal application exit discards temporary native media; forced termination is
not crash recovery and may leave disposable files. Do not assume secure erasure.

For browser layout preview and checks:

```sh
pnpm --filter @savia/companion dev
pnpm --filter @savia/companion build
pnpm --filter @savia/companion typecheck
pnpm --filter @savia/companion test
cargo test --manifest-path apps/companion/src-tauri/Cargo.toml
```

Browser preview cannot record audio. Native capture and HTTP forwarding use
narrow host commands. There is no generic filesystem or HTTP plugin exposed to
the renderer. Unsaved audio is temporary. Explicitly uploaded audio persists
in private backend R2 objects; browser storage is not used for meetings, credentials
or settings.

## Connect to Savia

1. Run your existing Savia API/auth stack and migrations. Configure OpenRouter
   through the existing encrypted assistant settings or deployment secret.
2. Explicitly set `COMPANION_ENABLED=true` in the API environment. Optional
   `COMPANION_STT_MODEL` selects the STT model; the default is
   `openai/whisper-large-v3`. Summary uses the existing effective assistant text
   model. Do not put provider keys in any frontend `VITE_*` variable.
   For the native local stack, run `COMPANION_ENABLED=true pnpm dev` from the
   monorepo root; restart an already-running stack to apply the flag. The local
   launcher also reads these settings from `infra/secrets/assistant-api.dev.env`.
3. Use a Savia OAuth access token for an **active tenant member or platform administrator**, scoped for
   `savia.api.read` and `savia.api.write`, obtained through the existing supported
   Savia OAuth flow. Paste it into the validation app's password field; it remains
   in memory. Built-in desktop OAuth/keychain integration is a later increment.
4. Enter the API origin (HTTPS, or local HTTP), then Check connection. Origins
   must have no path, credentials, query or fragment. Native forwarding rejects
   redirects to avoid disclosing the access token to another host.
5. Enter the main Savia application origin in Connection settings (normally
   `http://localhost:5173` locally). The compact 380 × 540 desktop window is only
   for capture and upload; transcription and summaries live in Savia.
6. Stop capture, confirm permission, then choose Upload to Savia. Each selected
   source is uploaded separately as private compressed audio; upload itself does
   not call OpenRouter. Use Open in Savia to open the recording library.
7. Sign in to the main Savia app with the same user account.
   Open **Recordings** in the Work menu, or `/#/companion-recordings`. Select a
   recording to listen or download its Ogg/Opus file. If your browser cannot
   decode Ogg Opus, use the download link and a compatible player/browser.
8. Confirm permission for remote processing, then choose Generate summary.
   Savia transcribes the selected saved source and generates structured draft
   notes: summary, decisions, actions and open questions. Expand Transcript to
   review the source text. No tasks, emails or business records are created.

The backend fails closed by default and restricts this prototype to platform
administrators. There is no general tenant cost/quota rollout yet. STT provider
routing/retention must be reviewed separately; chat routing preferences must not
be assumed to apply to audio. A controlled Spanish sample passed real OpenRouter
STT and summary generation; see the [live-flow report](../../docs/companion/live-flow-smoke.md).
Native system capture remains blocked in CoreAudio on the tested Mac.

Platform administrators can choose separate transcription and summary models in
**Keys and services → Platform credentials → Meeting recordings**. See the
[model configuration guide](../../docs/companion/model-configuration.md).

Notes persist privately in backend R2 beside their source audio. Reloading the
page reads saved notes without contacting the provider. A successful transcript
is retained if summary generation fails; a subsequent explicit request reuses it.
Completed notes are cached. Requests for the same owner/recording sharing an R2
binding are serialized within one Worker isolate. Cross-isolate duplicate paid
requests and ambiguous provider outcomes still require durable coordination.
A timeout or network failure can leave upstream billing uncertain: check provider
usage before choosing to try again. The client does not automatically retry.

The generated API at `/openapi.json` describes the `/v1/companion` routes. This
README is a usage guide rather than a hand-maintained API reference.

## Inspect a sample

```sh
pnpm --filter @savia/companion audio:inspect --help
pnpm --filter @savia/companion audio:inspect /absolute/path/to/finalized-sample.wav
```

The dependency-free inspector accepts finalized mono/stereo PCM16 RIFF/WAVE up
to 64 MiB and reports duration, sample rate, RMS, peak, exact-zero sample ratio
and samples at the integer limits per channel. These metrics cannot prove audio
intelligibility, permissions, absence of echo or speaker identity. The inspector
is a bounded diagnostic, not the future streaming upload path.

Keep real samples outside Git. Sources are not speakers. Long-session chunking,
frame alignment, playback, full saved meetings, tenant ACL rollout, encrypted offline
recovery and signed distribution remain separate epics.

## Licensing

This project inherits Savia's [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE).
Third-party dependencies retain their licenses; see the native
[dependency notes](THIRD_PARTY_NOTICES.md). No commercial Anarlog enterprise code
has been imported. Keep required Savia attribution in distributed UI and artifacts.

## Compressed sample storage

Stopping capture encodes each source as mono Ogg/Opus, targeting 32 kbps, and
discards temporary PCM. Capture commands run off the UI thread. On macOS,
system-helper readiness has a 12-second timeout and microphone authorization a
60-second timeout. Closing or quitting waits for capture disposal before exiting.
Encoding and resampling run locally without a system
FFmpeg installation. The raw WAV inspector remains a diagnostic tool. At the
target bitrate, one hour would use about 14.4 MB per source before container
overhead; this build still limits recordings to 60 seconds. Actual sizes vary.
Inputs above roughly 69 kHz can reach the 8 MiB raw cap before 60 seconds;
that condition is reported as a capture error. Use a 44.1/48 kHz device for the
full 60-second validation sample.

Saving is explicit and requires the existing R2 binding and an authenticated
active tenant member or platform administrator. Savia validates Ogg page checksums, mono headers, packet
duration, final granule, the 60-second limit and the 512 KiB encoded limit. R2
stores the audio and authoritative metadata under a hashed principal prefix;
list/download/delete endpoints enforce that same owner and the normal API scopes.
No public audio URL is created. Same-ID retries are idempotent; changing that
sample's audio or source returns a conflict. Save does not require a provider key.

Discard audio removes the local capture, not previously saved samples. Saved
samples can be retrieved/deleted through the authenticated generated API. This
increment does not yet implement automatic retention, tenant quotas or resumable
meeting uploads. Saved playback and transcript/notes persistence are implemented.
Compression quality and provider qualification still need the broader validation gate.
