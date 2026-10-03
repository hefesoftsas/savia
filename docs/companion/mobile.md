# Companion mobile preview

The Flutter app in `apps/companion-mobile` targets Android and iOS. It reuses the
Companion API and recording-session contracts with the Tauri desktop app. The mobile flavor is
fixed to `https://savia-preview.hefesoft.com`; production is not configured.

## User flow

1. Sign in using the system browser and choose an eligible Savia workspace.
2. Record microphone audio while the app is in the foreground, up to one hour,
   or import MP3, WAV, M4A or Ogg/Opus audio of up to 50,000,000 bytes.
3. Review the temporary draft, grant upload consent, and upload explicitly.
4. Read the backend library and play authenticated audio-file or session segments.
5. Grant provider-processing consent to generate a transcript and structured
   notes. Ask questions after a transcript exists; unsupported answers show an
   insufficient-evidence message. These operations do not create business tasks.

Backgrounding or audio interruption finalizes microphone capture. This preview
does not capture other apps' calls, record in the background, maintain an offline
upload queue, or expose cloud-drive import or deletion.

## Native public OAuth client

After reviewed backend deployment to preview, register a public native OAuth
client. The existing OAuth management API/UI is the preferred route:

- Application type: `native`.
- Client authentication: `none`; PKCE S256 is required.
- Exact redirect: `com.hefesoft.savia.companion.preview:/oauth/callback`.
- Grants: `authorization_code`, `refresh_token`.
- Scopes: `openid`, `profile`, `offline_access`, `recordings:read`,
  `recordings:upload`, `recordings:process`.
- Trusted: `false`, so authorization consent remains explicit.

Set the returned public ID with `--dart-define=SAVIA_MOBILE_CLIENT_ID=...` and the
repository variable `SAVIA_MOBILE_CLIENT_ID` for internal CI artifacts. No
registered ID is fabricated or bundled in the repository. A client secret must
never be added to Flutter configuration. Generated OpenAPI remains the canonical
API reference.

Authorization and refresh explicitly request the preview API resource
(`https://savia-preview.hefesoft.com`). The authorization-code exchange inherits
the resource bound to its code, so access tokens carry the audience required by
recording endpoints. The combined AppAuth flow retains its PKCE, state, nonce
and ID-token validation.

The new authenticated session discovery endpoint returns only subject, display
name, eligible workspaces, and recording scopes. Recording requests select a
workspace with `x-savia-tenant-id`. Active membership, scope, workspace and owner
checks all apply. Recording-scoped OAuth does not infer ownership of old recordings
without workspace metadata. Existing interactive legacy access and personal-key
route restrictions remain separate.

## Device data and failures

Only the refresh credential and its issuer/client binding persist in native secure
storage. Access tokens, workspace choice, library, notes and questions stay in
memory. Android backup and cleartext are disabled; iOS uses nonsynchronizing,
this-device Keychain storage. Temporary audio lives under the app cache directory
and is excluded from OS backup by cache location. Picker cache is cleaned after
copying; the source document is never deleted.

Successful upload, discard, sign-out and next startup clear app-owned drafts.
Authenticated playback files are deleted after decoder disposal. An uncertain
upload keeps the same draft UUID; refresh the library before an explicit retry.
There are no automatic write or paid-provider retries. A summary failure rereads
notes so a saved transcript remains visible. Errors expose only safe descriptors,
not response bodies or credentials, and are translated at render time.

Refresh is serialized and rotated credentials replace old credentials. Sign-out
clears local state even if remote revocation fails, and reports that failure.
Native credential storage/permission failures remain device qualification items.

## Automated and device validation

The workflow `.github/workflows/companion-mobile.yml` runs analyzer, tests, Android
debug compilation and unsigned iOS simulator compilation. These checks do not
prove microphone permissions, browser callback delivery, playback, or provider
quality on physical devices.

The integration smoke is opt-in and requires a human to finish system-browser
login, an eligible workspace, and an app-readable synthetic spoken audio fixture
containing: “The project code is Cedar.” It uploads once, recreates in-memory app
services, restores the session, reads the backend library and downloads audio.
Paid processing is disabled unless explicitly enabled:

```sh
flutter test integration_test/companion_smoke_test.dart -d <device> \
  --dart-define=SAVIA_RUN_PREVIEW_SMOKE=true \
  --dart-define=SAVIA_MOBILE_CLIENT_ID=<public-id> \
  --dart-define=SAVIA_SMOKE_WORKSPACE_ID=<id> \
  --dart-define=SAVIA_SYNTHETIC_AUDIO_PATH=<device-path> \
  --dart-define=SAVIA_ALLOW_PAID_PROCESSING=true
```

The paid branch checks persisted transcript/summary, a supported answer and
insufficient evidence. This programmatic smoke is not a substitute for the manual
system-picker, audible-playback or process-kill tests below.

On one physical Android and one physical iOS device, record evidence for:

- Microphone denied, then allowed; one-hour automatic stop; app background and interruption.
- System document picker cancellation/import, upload consent and unchanged source.
- Browser login return, user cancellation, refresh rotation and sign-out.
- App process restart followed by server retrieval, and audible playback.
- Successful notes, partial transcript recovery and grounded/unsupported answers.

## Evidence for this increment

Local evidence on 2026-10-03:

| Check                           | Result                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Flutter analyzer                | No issues                                                                                             |
| Flutter tests                   | 46 passed: configuration, session, transport, capture, playback, controller and widget coverage       |
| Android debug APK               | Built with task-local Temurin 17, Android SDK 36 and Flutter 3.47.6; no public client ID configured   |
| Root `pnpm run typecheck`       | Passed                                                                                                |
| API regressions                 | 138 passed across eight auth/identity/Companion suites                                                |
| Real Better Auth native fixture | 19 native tests; the current full auth suite passed 199 tests across 23 files                         |
| Visual review                   | Synthetic library/detail rendered at 390 × 844; ES/EN/PT failure rendering and 200% text tests passed |

Full Xcode is absent on this Mac, so local iOS compilation was not performed.
No Android physical device appeared in `adb devices`; no iOS physical-device
qualification was performed. The dedicated mobile CI run [37129079279](https://github.com/hefesoftsas/savia/actions/runs/37129079279)
successfully built both Android and an unsigned iOS simulator app for commit
`67705861`. This establishes compilation, not physical-device qualification.

On 2026-10-03, the preview native client was registered through the deployed
OAuth dynamic-registration endpoint and its public ID configured in the repository
variable `SAVIA_MOBILE_CLIENT_ID`. Dynamic registration adds provider default
scopes, so the newly created client's scopes were explicitly narrowed by the
preview infrastructure administrator to the six scopes listed above. PKCE was
set to required and consent skipping disabled. Read-back confirmed the exact
callback, grants, scopes and flags. Authorization checks accepted the configured
client and rejected missing PKCE and a different callback.

The preview browser session remains at sign-in. Authenticated synthetic upload,
real microphone capture, audible playback and paid notes/answers still require
account access and device qualification. No store release is claimed. Older debug
APKs built without a client ID intentionally show the setup screen.

Follow-up regressions preserve the administrative client's original scope list
and legacy public loopback callbacks. Mobile processing resolves AI configuration
from the same membership-validated selected workspace as recording access; tests
reject missing/inactive workspaces before any provider call.

## Visual hierarchy

The mobile theme follows Savia's emerald actions and neutral reading surfaces.
Recording names, metadata, playback, notes and questions have distinct typography
and spacing. Capture emphasizes its primary microphone action; upload and provider
consents remain adjacent to the actions they authorize. Error notices include an
icon and text, and layouts adapt to enlarged text and tablet widths.

## One-hour capture increment

The mobile source now caps foreground microphone capture at one hour and targets
mono AAC at 32 kbps. An hour is approximately 14.4 MB of encoded audio before
container overhead; actual encoder output varies and the existing 50 MB file
check remains authoritative. The native recorder writes to an app-owned temporary
file. Backgrounding, interruption, cancellation and explicit upload consent keep
their existing behavior. This change does not enable locked-screen capture.

Automated timer tests can establish the stop boundary without waiting an hour.
A continuous physical-device recording, audible playback and live one-hour
transcription remain separate qualification checks. Captured microphone audio now uses the durable session path described below.
Imported audio files retain the existing file-processing path.

A synthetic 3,600-second FFmpeg AAC file at the new target bitrate was 14,820,156
bytes and passed the existing API M4A validator. Its media-header duration was
3,600.043 seconds (AAC padding); ffprobe reported 3,600 seconds of presentation.
This is file-format evidence, not a physical-device capture or live STT result.

## Phase 2 recording sessions

Foreground microphone capture produces one private M4A draft. After upload consent,
Android MediaExtractor/MediaMuxer or iOS AVAssetExportSession splits it into up to
120 independently playable 30-second AAC segments. Native code copies compressed
audio without loading an hour of PCM into Dart memory. Each segment is limited to
512 KiB; imports retain their separate 50 MB limit.

The draft UUID identifies an idempotent backend session. Temporary segment files
and their manifest preserve exact bytes across an explicit upload retry. Saved
backend chunk identities are checked before uploading missing segments. Finalization
requires the complete timeline; incomplete uploads cannot start processing.
Successful upload, explicit discard and existing draft cleanup remove temporary
artifacts. This does not introduce a persistent offline upload queue.

The library exposes audio files and recording sessions. Session details fetch saved
results separately from metadata listings and poll while processing is active.
Provider consent queues durable transcription and summary work; saved transcript
segments support questions with source/time evidence before the full job finishes.
Cancelled or ambiguous processing requires a separate retry acknowledgment because
an earlier provider request may already have incurred a charge.

See [recording sessions](long-recording-next-phase.md) for ownership, limits,
processing leases, desktop recovery and the remaining physical-device qualification.

Phase 2 local verification: Flutter analyzer passed, all 64 tests passed, and the
Android debug APK compiled with the configured preview public OAuth client.
Regression coverage includes segment retry identity, separate ambiguous-job retry
consent, desktop Ogg/mobile M4A metadata, and playback switching/close races.
iOS compilation remains a CI check; no physical-device qualification is implied.
