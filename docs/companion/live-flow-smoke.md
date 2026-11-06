# Companion live-flow smoke test

Owner: Savia platform maintainers. Date: 2026-10-01 (America/Bogota).

## Scope and isolation

The user requested the complete flow. This run uses the current checkout, a
private disposable SQLite database and a test administrator enrolled through the
real sign-in and TOTP endpoints. The app runs on loopback port 5194. Existing
API/frontends from other checkouts are not restarted. Stored samples use the
existing local S3-compatible object store through the self-hosted R2 adapter.
Only generated Spanish speech is submitted; no meeting or microphone audio is
used. Provider credentials stay on the backend and are never recorded here.

## Backend and main-app evidence

A generated 14.0659-second spoken sample was encoded to mono 48 kHz Ogg/Opus,
57,028 bytes, and uploaded through the authenticated Companion API. This is a
backend preflight sample, not a successful native-desktop capture.

- Real sign-in, MFA enrollment/verification and platform-admin authorization
  succeeded. The authenticated capabilities endpoint advertised private storage,
  `openai/whisper-large-v3` STT and `deepseek/deepseek-v4.1-flash` summaries.
- The private upload returned 200. An authenticated audio download returned 200;
  its SHA-256 matched the uploaded bytes exactly.
- The actual Savia admin shell exposed **Grabaciones**. The saved sample appeared
  under the same test principal. The in-app browser decoded the Ogg file without
  a media error, and playback reached its end (14.072396 seconds in the player).
- Generate summary stayed disabled until explicit processing consent was checked.
  A single user-interface action made real OpenRouter transcription and summary
  requests. These were paid-provider operations, not mocked responses.
- The returned transcript and draft notes recovered the decision to keep the
  desktop window small and review recordings in Savia, Ana's playback-test task
  for tomorrow, and the pending Windows capture validation.
- The ASR spelled Savia as "Sabia" and Companion as "compañía". This illustrates
  why proper names and AI draft notes still need human review; no general quality
  qualification is claimed from this one synthetic sample.
- Saved notes returned 200 and survived a main-page reload. Reloading restored
  the source and notes rather than running generation again.

## Native capture finding

The initial compact-app system-only capture stalled in the macOS helper startup
handshake. A process sample showed Tauri's main thread blocked in
`SystemCapture::start` while reading READY from the helper. A separate helper
probe stalled inside CoreAudio's `AudioDeviceCreateIOProcIDWithBlock`. The actual
macOS System Audio Recording Only permission for Savia Companion was already on;
no OS permission settings were changed. The initial recording ultimately failed
finalization, so it is not counted as a completed capture/upload flow.

The implementation was changed to run capture IPC on a blocking worker pool,
bound helper readiness to 12 seconds, bound microphone authorization to 60
seconds, and drain bounded startup diagnostics. Synthetic helper regressions
cover stalled startup, stderr errors and authorization timeout.

After rebuilding, system-only capture returned a recoverable startup error after
12 seconds instead of freezing the WebView. Capture did not produce a native
sample: the full desktop-to-provider flow remains **blocked**, while the backend
and main-app path passed with generated speech. The microphone was left off.

A final macOS debug build included exit coordination: close/quit requests wait
for one background capture disposal. Quit was exercised after starting the
system helper. Both the application and helper exited, and their observed
`savia-companion-*` temporary directory was removed. Native library tests passed
all 17 checks; `cargo fmt --check` and the desktop build passed. Full monorepo
checks and Windows device tests were not run in this increment.

## Cleanup

The disposable recording was deleted through the authenticated API (204). The
test owner's list was empty, and both audio and notes reads returned 404. The
test API session was signed out (200), the temporary browser tab was closed,
and the isolated server was stopped. Generated audio, diagnostic probes,
credentials and the disposable database were removed. The compiled app remains
available; a sanitized UI screenshot and this report retain the evidence.

## Limits

This run does not qualify Windows, microphone capture, long meetings, provider
privacy/retention, diarization or general speech accuracy. Provider billing totals
were not exported; the application currently does not persist returned STT usage.

## Preview follow-up — 2026-10-02

The deployed preview at `https://savia-preview.hefesoft.com` was exercised through
the signed-in Chrome UI. This follow-up did not deploy code or change provider
credentials or model settings.

- The existing native app's API and application origins were set to preview for
  its current in-memory session. It remained **Not connected** because no Savia
  access token had been entered; native authentication is still unverified.
- An anonymous capabilities request returned HTTP 401 with
  `AUTHENTICATION_REQUIRED`.
- A generated Spanish WAV named `savia-preview-validation.wav` uploaded through
  **Recordings** successfully. The UI reported 15.3 seconds and 479 KiB. The sample
  remained listed after navigating away and returning. No private meeting audio
  was used. The synthetic recording was retained for further diagnosis.
- After explicit processing consent, **Generate summary** failed. The UI showed
  “Processing failed. Check provider usage before trying again.” No transcript or
  summary was displayed. No processing retry was made. Provider billing and the
  underlying response status were not available from that UI result.
- Platform settings showed an encrypted OpenRouter key configured, a global chat
  model of `deepseek/deepseek-v4-flash-0731`, and blank transcription and summary
  overrides. A configured key alone does not establish provider availability.
- Source inspection confirmed that recording question answering is not yet
  implemented: there is no per-recording question endpoint or question UI.
- The five dependency-free audio inspector tests passed in the current checkout.
  Native capture, native authenticated upload, audio playback, summaries and
  question answering were **not validated** by this follow-up. Full package and
  monorepo suites were not run.

## Scoped credentials and questions — 2026-10-03 (local verification)

The personal API key implementation adds account creation/revocation with four
recording scopes, one-time secret reveal, digest-only storage, expiry and a bound
workspace/deployment. Companion accepts the credential in memory and checks its
upload permission. The recordings page can ask a consented question against the
selected saved transcript; answers are temporary drafts with an explicit
insufficient-evidence outcome.

Local verification includes real D1/R2 lifecycle, scope and tenant-isolation
tests, provider-boundary Q&A tests, account and recording UI tests, a Companion
frontend build, and 24 native Rust tests. A browser check rendered the production
panels with local fixture data; its answer was simulated. It is not provider or
preview validation. The PostgreSQL manifest checks passed, but 10 live PostgreSQL
cases were skipped because no test database was configured.

The fresh review's deployment-origin fallback, tenant hostname contradiction and
last-use timing findings were corrected. Keys fail closed on remote deployments
without a configured canonical public origin; both hostname and gateway tenant
hints must agree with the bound workspace. Last use records successful requests.

Preview has not yet received this increment. The earlier synthetic upload remains
the only preview upload evidence. Its processing failure still needs a sanitized
backend/provider diagnosis. Native connection/upload, successful preview summary
persistence, real grounded answers and a successful CoreAudio capture remain
unverified. Integration must follow the documented main → CI → preview workflow;
no production deployment or provider configuration change was performed here.


## Preview connection and upload — 2026-10-03

PR #124 was merged and deployed successfully to preview (commit
`ad4abf62313cc8608c91c6665001c5127f6816f5`). After action-time approval, the account
UI created **Companion preview**, bound to **Plataforma Savia**, with
`recordings:read` and `recordings:upload` and a seven-day expiry. The one-time
secret was entered only into the native application's secure credential field;
it was not saved to a file or printed. The account reveal was dismissed.
The freshly compiled native application displayed **Connected** against
`https://savia-preview.hefesoft.com`.

A microphone-only attempt ended with the bounded message that microphone
permission did not resolve within 60 seconds. Inspection located this wait in
the macOS authorization helper, before the CPAL microphone worker starts. No
native audio was uploaded. This does not prove an audio worker startup failure.

A new synthetic Spanish WAV (13.0 seconds, 410 KiB) uploaded through the signed-in
web recordings page and remained listed after a reload. It contains only a
fabricated meeting about publishing a Friday test, Ana reviewing audio, Luis
preparing a summary, and an undecided budget. This validates web upload and
persistence on the new deployment, not native upload.

The earlier processing retry returned HTTP 502 without a transcript. Successful
preview transcription, summary and grounded question answering remain
unverified. A diagnostic increment adds the fixed
processing stage and upstream HTTP status without exposing provider response
bodies, audio, prompts, headers or credentials. No provider configuration was
changed and no additional provider request was made during this connection run.
