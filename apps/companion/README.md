# Savia Companion validation application

Owner: Savia platform maintainers. Reviewed: 2026-10-01.

A Tauri desktop preview for manually recorded microphone/system audio,
connected to Savia's opt-in OpenRouter processing adapter. Sessions are limited to
one hour, with 30-second segments bounded to 8 MiB temporary PCM and 512 KiB compressed audio each. This is an implementation increment, not a
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
   `COMPANION_STT_MODEL` selects the deployment audio-input model; the default is
   `google/gemini-2.5-flash`. Platform and tenant administrators can override the
   transcription and summary models in **Keys and services**. Audio is sent through
   OpenRouter chat completions. See [model configuration](../../docs/companion/model-configuration.md). Do not put provider keys in any frontend `VITE_*` variable.
   For the native local stack, run `COMPANION_ENABLED=true pnpm dev` from the
   monorepo root; restart an already-running stack to apply the flag. The local
   launcher also reads these settings from `infra/secrets/assistant-api.dev.env`.
3. Create a [personal API key](../../docs/guides/personal-api-keys.md) in **My account → API keys**, with recording read and upload permissions. Alternatively use a Savia OAuth access token for an **active tenant member or platform administrator**, scoped for
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

The backend fails closed by default and requires an active tenant membership
or platform administrator access. There is no general tenant cost/quota rollout yet. STT provider
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

## Segmented recording sessions

Desktop capture keeps devices open and encodes bounded 30-second Ogg/Opus segments
for up to one hour. A private native spool preserves completed segments on close;
Discard deletes the local draft. Upload resumes missing immutable segments in an
owner/workspace session. Savia provides playback, durable background processing,
summary and evidence-grounded questions with separate provider consent.

See [phase 2](../../docs/companion/long-recording-next-phase.md) for limits,
recovery semantics and the distinction between synthetic and real-device validation.
