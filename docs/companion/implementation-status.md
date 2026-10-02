# Companion implementation status

Owner: Savia platform maintainers. Reviewed: 2026-10-01.

## Implemented increment

This change introduces a bounded validation application, not the complete roadmap.
The compact desktop UI (380 × 540 px) provides manual source selection,
capture/stop/discard, explicit upload consent and a link to the main Savia app.
Savia's authenticated Recordings page provides owner-private audio playback and
download, explicit consented generation, saved transcript review and structured
meeting-note review. The backend has opt-in platform-administrator-only
capabilities, bounded WAV/Ogg Opus transcription and summary operations. Provider
credentials stay on the backend; meeting notes never execute tools or create
business records automatically.

Validation sessions are limited to 60 seconds, 8 MiB temporary PCM and 512 KiB
compressed audio per source. API request
bytes are counted before JSON validation even when Content-Length is missing or
incorrect. Provider responses are bounded and redacted; paid provider requests
are not automatically retried. Transcription and summary use separate models.
STT provider routing remains unverified; enabling the prototype requires an
operator to review provider terms and accept this limitation.

Unsaved audio remains temporary and is cleared on normal application exit.
Uploaded compressed samples and generated notes persist privately in R2, fetched
from the backend when Savia opens a recording. A failed summary retains the
successful transcript. Completed notes are returned without another provider call.
Per-recording processing is serialized for a shared bucket binding within one
Worker isolate; cross-isolate exactly-once billing is not guaranteed.
Temporary native capture files are disposable proof artifacts, not a recovery
spool. Durable full meetings, background jobs, timestamp-aligned corrections,
global speaker identities, automatic attendees and meeting bots remain pending.

## Epic tracking

| Epic   | Implementation progress                                                 | Gate                                                                             |
| ------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| CMP-00 | Workspace, executable tools, documentation                              | Scaffold gate passed.                                                            |
| CMP-01 | Manual start, visible capture state, explicit remote-processing consent | Full policy/launch review pending.                                               |
| CMP-02 | Desktop host and narrowly scoped commands; in-memory access token       | OAuth sign-in UX, keychain/session lifecycle and security qualification pending. |
| CMP-03 | macOS native adapter                                                    | Actual permission/device capture evidence pending.                               |
| CMP-04 | Windows native adapter                                                  | Windows build/device qualification pending.                                      |
| CMP-05 | Bounded source captures and monotonic session elapsed time              | Shared frame alignment, drift and echo qualification pending.                    |
| CMP-06 | Local mono Opus at a target 32 kbps; temporary PCM discarded            | Long-session independently decodable chunking pending.                           |
| CMP-07 | Dedicated OpenRouter STT and separate summary adapter                   | Live model discovery, benchmarks, billing and privacy eligibility pending.       |
| CMP-08 | Private audio storage and persisted transcript/draft notes              | Durable meetings, tenant ACL rollout, quotas, retention and jobs pending.        |
| CMP-09 | Explicit discard and process-lifetime cleanup                           | Encrypted crash/offline recovery pending.                                        |
| CMP-10 | Main-app playback, transcript and structured draft notes                | Corrections, time evidence, diarization and quality evaluation pending.          |
| CMP-11 | Local build configuration and tests                                     | Signed installers, updates and sustained qualification pending.                  |

No native platform or provider gate is marked passed by compilation or synthetic
tests. Follow the [validation protocol](validation.md) for those experiments.

## Initial increment verification (before compressed storage)

Checks performed locally on 2026-10-01:

| Check                                  | Result                            | Scope                                                                                                                                    |
| -------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @savia/companion test`  | 9 tests passed                    | Five synthetic WAV tests and four client-boundary tests.                                                                                 |
| `pnpm --filter @savia/companion build` | Passed                            | TypeScript and production web assets.                                                                                                    |
| API test suite                         | 103 files, 769 tests passed       | Full API suite before two additional Companion regressions were added.                                                                   |
| Companion API test files               | 13 tests passed                   | Current routes/service tests, including authentication, consent, generated OpenAPI, actual request-size bounds and a full 60-second WAV. |
| Self-hosted test suite                 | 65 tests passed; 43 skipped       | External PostgreSQL, Docker and object-storage integration fixtures were unavailable.                                                    |
| `pnpm run typecheck`                   | Passed                            | All packages in the repository's root typecheck command, including Companion.                                                            |
| Browser preview                        | Wide and narrow layouts inspected | No console errors observed; browser capture is deliberately disabled.                                                                    |

The full native `cargo test` run passed six unit and seven lifecycle tests without
opening audio devices. `cargo fmt --check` passed. The final
`pnpm --filter @savia/companion desktop:build --debug --bundles app` command built
the local macOS debug application bundle; distribution signing remains unqualified.
An isolated compile-only harness checked the actual CPAL/WASAPI adapter source for
`x86_64-pc-windows-msvc`. That check passed with expected unused-code warnings in
the harness; it is not a full Windows/Tauri link or a device execution.

The initial build checks did not exercise real audio, and Computer Use was
unavailable during that implementation run. A subsequent user-authorized
[macOS system-output smoke test](macos-system-audio-smoke.md) used the desktop UI
and captured 36.149 seconds of non-silent PCM while YouTube played, with the
microphone disabled. The stopped sample, WAV evidence copy and screenshots were subsequently deleted
at the user's request. Only the metrics report remains. Listening/intelligibility, microphone capture, the full macOS device and
permission coverage, Windows installation/capture and live OpenRouter
billing/quality/privacy checks remain pending. No provider requests or credentials
were used in the capture smoke test; G1/G2 are not marked qualified.

Scoped formatting and `git diff --check` were checked. The full monorepo test suite
and root lint were not run; root lint has a documented pre-existing failure on main.

## Compressed storage increment

Each stopped source is cached as mono Ogg/Opus at a target 32 kbps. The native
encoder/resampler dependencies use MIT or Apache-2.0 licenses. PCM is temporary
and removed after successful encoding. The desktop exposes explicit Upload; the main Savia page reads recordings and
notes from the backend rather than client persistence.

CMP-08 now has a bounded personal-sample foundation: authenticated private R2
objects, owner-isolated listing/download/deletion, idempotent same-ID saves,
container validation, 60-second and 512 KiB per-source limits. Full meeting
records, tenant authorization, quotas, retention and resumable uploads are pending.
Synthetic codec fixtures and local R2 tests do not qualify live STT accuracy.

### Compressed-storage verification

- Companion API: 22 targeted tests passed (container corruption/bounds, compressed
  provider payload, private R2 lifecycle, ownership, conditional/idempotent save,
  generated routes and authenticated streaming download). R2 tests used an
  isolated local Workers bucket and deleted their saved test objects.
- Companion web/diagnostic tests: 10 passed; production web build passed.
- Self-hosted object-store adapter: 6 tests passed. Local API launcher: 1 passed.
- Full API run: 775 passed, 4 timed out at the unchanged 15-second limit under
  concurrent compile/check load. All three affected files were rerun together:
  54 tests passed with the original timeout (collection versions, insurance
  automation and public forms). The full run itself is not recorded as green.
- API and Companion TypeScript checks passed. The broader root typecheck was
  interrupted during the admin check to reduce competing load; it was not
  completed for this increment. Root lint and the full monorepo test suite were
  not run.

- Native: 11 unit and 7 lifecycle tests passed, including exact FFmpeg/libopus
  decoded frame counts for non-frame-aligned 44.1 kHz and full 60-second samples,
  encoded bounds, resampling and visible raw-byte overflow errors. `cargo fmt
--check` passed. The native short fixture also passed the API inspector and is
  retained only as a tiny synthetic regression fixture. Optimized debug encoding
  of one 60-second source took 1.88 seconds in the measured run; timing varies.
- Windows compile-only harness now includes the actual codec, ruopus/Rubato and
  CPAL/WASAPI source; the MSVC target check passed. Full Windows app linking and
  device capture remain untested. The disposable harness and test progress files
  were removed; the local toolchain and usable macOS application build remain.

- Final `pnpm --filter @savia/companion desktop:build --debug --bundles app`
  passed after all codec, overflow and UI changes. The macOS debug `.app` is
  available locally; it is not a signed distribution or a Windows installer.
- Scoped Prettier and `git diff --check` passed. The YouTube WAV, screenshots,
  native capture directory, synthetic binary export and Windows test harness
  were deleted. Synthetic source fixtures and automated regression tests remain.

## Compact capture and main-app review increment

On 2026-10-01:

- Companion uses a 380 × 540 window (minimum 320 × 460), collapsed connection
  settings, independent source switches and one primary Start/Stop/Upload action.
  Transcription, summaries and the library are reviewed in the main application.
- Savia adds the platform-admin Recordings navigation entry and authenticated
  `/#/companion-recordings` page. The native review link opens this fixed route
  without including tokens. Audio uses authenticated downloads and temporary
  blob URLs that are revoked when the view closes or changes source.
- Generated notes are schema-validated private R2 sidecars. Owner isolation,
  explicit consent, cached results, partial transcript reuse, deletion cleanup,
  cross-app in-isolate serialization and oversized-cache rejection are tested.
  API reference types were regenerated from OpenAPI.
- Companion API: all 5 targeted files passed, 33 tests. Admin feature/navigation/
  authorization checks passed, 39 tests; user-preferences checks passed, 16 tests.
  Companion tests passed, 10 tests. Native browser-opening checks passed,
  5 targeted backend unit tests. API, admin and Companion TypeScript checks passed.
- Admin production assets and the final macOS debug application bundle built
  successfully. Native compact-window visual inspection used the actual app;
  main-page desktop/390 px mobile inspection used clearly labeled synthetic
  server-backed data. Playback, consent and saved notes after reload were checked;
  the temporary test page and fixture server were removed. Full monorepo tests,
  root lint, Windows device testing and live paid STT/summary requests were not
  performed for this increment.

These checks qualify the bounded implementation only. Long meetings, background
processing, crash recovery, tenant rollout and provider qualification remain open.

## Live-flow test and native startup recovery

The [controlled live-flow report](live-flow-smoke.md) records actual local private
storage, sign-in/MFA, Ogg playback, one real OpenRouter STT request, one real
summary request and persisted notes after reload. Its generated Spanish sample
was 14.0659 seconds and 57,028 bytes. Proper-name transcription errors remain
visible; this single sample does not qualify general quality or privacy.

Native system capture stalled in CoreAudio on the tested Mac despite the enabled
system-audio permission. Capture commands now run off the WebView thread; macOS
helper startup times out after 12 seconds and microphone authorization after
60 seconds. Close/quit waits for one capture cleanup before exiting. A real retry
returned a recoverable error, and quit removed both helper and temporary capture
directory. The full native-to-provider flow remains blocked.

All 17 native library tests, native formatting and the final macOS debug bundle
build passed. Full monorepo checks and Windows hardware checks were not run for
this increment. The disposable recording/notes, credentials, database, generated
audio and diagnostic probes were removed after testing.

## Configurable meeting models

On 2026-10-02, the global assistant settings and platform Keys and services page
add an independent Meeting recordings entry. Transcription and summary model IDs
persist in backend settings, reuse the existing effective OpenRouter key, and
apply to Companion processing. Partial writes preserve the chat model and key.
Tenant writes reject meeting model fields; summary fallback respects the effective
assistant model. See the [configuration guide](model-configuration.md).

- Focused API configuration/Companion checks passed, 50 tests. The initial broader
  API run had two failures in test setup/expected configuration; these were fixed
  and the affected focused run passed. The broader run is not reported as green.
- Admin configuration/client/service credentials checks passed, 18 tests, including
  preserved drafts and preventing saves after failed configuration loading.
- Admin, API, DB and self-hosted TypeScript checks passed; admin production assets
  built successfully. SQLite baseline checks passed, 5 tests. PostgreSQL migration
  checks passed, 2 tests; 10 live PostgreSQL cases were skipped because no live
  test database was configured.
- Desktop and 390 px mobile layouts were inspected with labeled synthetic data
  backed by a disposable local fixture server; saved fields survived reload and
  mobile content did not overflow. An independent review found a failed-load
  clearing risk, now fixed and covered by a regression. The mechanical design
  detector reported no findings. Formatting and diff whitespace checks passed.
- No paid provider requests, live deployment migration or full monorepo test run
  were performed for this settings increment. The fixture server, browser tab and
  temporary preview data were removed; sanitized screenshots retain visual evidence.
