# Savia Companion Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an internal Flutter Android/iOS Companion client for scoped Savia login, short microphone capture, audio imports, explicit uploads, saved notes and grounded questions.

**Architecture:** A separate Flutter app consumes Savia's existing recording backend. Native adapters own OAuth, secure credentials, microphone, picker and playback; domain controllers are independently testable. Extend native-public OAuth and narrow recording scopes without changing existing desktop, personal-key or admin authentication contracts.

**Tech Stack:** Flutter/Dart; flutter_appauth, flutter_secure_storage, record, file_picker, just_audio and path_provider behind adapters; Dio for cancellable streamed HTTP and uuid for draft IDs; existing Hono/Better Auth/D1/R2 services. Verify compatible stable dependency versions and pin the SDK/lockfile in Task 1.

**Spec:** [Approved mobile design](../specs/2026-10-03-companion-mobile-design.md), approved by the user on 2026-10-03.

## Global Constraints

- New project: `apps/companion-mobile`; existing Tauri desktop remains intact.
- Microphone capture is foreground-only and limited to **60 seconds**.
- Imports: MP3, WAV, M4A and Ogg/Opus, at most **50,000,000 bytes**.
- Preview callback: `com.hefesoft.savia.companion.preview:/oauth/callback`.
- Public OAuth client, PKCE S256, system browser; no client secret in the app.
- Requested scopes: `openid`, `profile`, `offline_access`, `recordings:read`, `recordings:upload`, `recordings:process`.
- Backend is authoritative for the library and saved notes; one temporary local draft; native secure storage only for refresh credentials and minimal session identity.
- Access tokens and questions/answers remain in memory. No provider secrets in the client, URLs, logs or analytics.
- No automatic retries for writes or paid processing; keep the draft UUID for manual retries.
- Spanish, English and Portuguese; Savia attribution, scalable text and accessible status labels.
- Code, tests and docs in English; conventional English commits.
- No production enablement, store publication, call/system-audio capture, background capture or offline queue.

## Review Focus

- A late HTTP result after workspace switch/sign-out must not repopulate another session's UI (Tasks 3 and 6).
- Simultaneous requests near token expiry must perform one refresh; no paid request may be replayed after an ambiguous failure (Tasks 3 and 4).
- Picker cancellation, app backgrounding or microphone denial must not delete the selected original file or leave capture running (Task 5).
- A timeout after the server saved audio must preserve the UUID and avoid a second recording (Tasks 4 and 5).
- A partial transcript, unsupported question or locale change must remain understandable without retranscribing or leaking raw provider errors (Task 6).

## File and interface map

Dart paths below are relative to `apps/companion-mobile`; TypeScript paths are repo-relative.

- `lib/app.dart`, `lib/config.dart`, `lib/l10n/app_{en,es,pt}.arb`: app composition, fixed preview config, localization.
- `lib/session/{session_controller,oauth_adapter,secure_session_store}.dart`: login, refresh and sign-out.
- `lib/recordings/{models,recordings_api,recordings_controller}.dart`: validated response models, HTTP, session-bound remote state.
- `lib/capture/{draft,capture_controller,native_capture,document_import,temp_files}.dart`: one local draft and native lifecycle.
- `lib/screens/{connect,library,capture,recording_detail}_screen.dart`: screen composition; no direct plugin or HTTP calls.
- `lib/playback/audio_player_adapter.dart`: bounded temporary playback lifecycle.
- `test/{session,recordings,capture,screens}/`: unit/widget tests mirroring the behavioral modules.
- `integration_test/companion_smoke_test.dart`: opt-in real app/backend smoke; no default paid requests.
- `docs/companion/mobile.md`: setup, boundaries, build commands and actual evidence.

## Task 1: Reproducible Flutter shell and supported preview configuration

**Files:** Create `apps/companion-mobile/{pubspec.yaml,pubspec.lock,analysis_options.yaml,.fvmrc,README.md}`, standard `android/` and `ios/` Flutter targets, `lib/{main,app,config}.dart`, `lib/l10n/app_{en,es,pt}.arb`, `test/config_test.dart`, `test/screens/connect_screen_test.dart`; modify root `.gitignore` only for Flutter build/tool outputs.

**Interfaces:** `MobileConfig.preview({required String clientId})` supplies `apiOrigin`, `issuer`, `clientId`, `redirectUri` and `scopes`; `CompanionApp` accepts injected session/recording/capture adapters. The API origin is `https://savia-preview.hefesoft.com`; issuer is its `/api/auth` URL.

- [ ] Locate existing Flutter/Dart, Android SDK/JDK and full Xcode installations without broad filesystem scans. Record actual tool paths/versions. Install missing task-local Flutter tooling from official stable distribution if needed; do not claim iOS tooling from Command Line Tools alone.
- [ ] Pin the selected stable Flutter release in `.fvmrc`; scaffold Android/iOS only, with application identifier `com.hefesoft.savia.companion.preview`. Resolve the listed plugin families against that SDK, commit the lockfile and document the exact commands; do not globally alter unrelated projects' tools.
- [ ] Write failing configuration/widget tests: `expect(config.redirectUri.toString(), 'com.hefesoft.savia.companion.preview:/oauth/callback')`; assert the exact scopes, fixed HTTPS origin, a visible Preview label, and disabled login with a clear setup message when the public client ID is absent.
- [ ] Run `flutter test test/config_test.dart test/screens/connect_screen_test.dart` from the mobile directory; verify behavior fails before implementation.
- [ ] Implement immutable `MobileConfig`, the injected app shell and generated Flutter localizations. Read the public client ID from `--dart-define=SAVIA_MOBILE_CLIENT_ID`; never invent a working client ID or bundle a secret. Use Flutter `ChangeNotifier`/`ListenableBuilder` for the small controllers instead of adding a state-management framework.
- [ ] Run `flutter analyze` and the focused tests; require no analyzer errors and passing assertions. Commit `feat: scaffold Flutter Companion mobile shell`.

## Task 2: Native-public OAuth and recording authorization contracts

**Files:** Modify `apps/auth/src/oauth.ts`, `apps/api/src/auth/{better-auth,oauth-resource,types}.ts`, `apps/api/src/routes/identity.ts`, `apps/api/src/companion/routes.ts`; create `apps/api/src/auth/recording-scope-policy.ts`, `apps/auth/test/oauth-native-client.test.ts`, `apps/api/test/companion-oauth-scopes.test.ts`; extend `apps/api/test/{identity,personal-api-key-auth,companion-tenant-keys}.test.ts`; regenerate `apps/admin/src/api/generated/openapi.ts` through its existing command; create `docs/companion/mobile.md`.

**Interfaces:** Add optional `applicationType: 'native' | 'web'` and permitted grant selection to managed OAuth client input while preserving defaults. Add `requiredRecordingScope(request: Request): RecordingScope | null` for a narrow route allowlist. Add credential variant `{kind:'oauth'; scopes: string[]}` to authenticated actors, preserving existing personal-key semantics. Add authenticated `GET /v1/companion/session` returning `{subject, displayName, workspaces: {id:number,name:string,slug:string}[], grantedRecordingScopes:string[]}` for read-scoped OAuth users.

- [ ] Write failing native-client tests: exact approved callback + public `none` auth + PKCE accepted; wildcard/fragment/credential-bearing callback, mixed native/web redirects, native secret and unregistered callback rejected. Confirm existing admin/Scalar client defaults remain unchanged and authorized native clients can obtain refresh grants with `offline_access`.
- [ ] Write failing API tests for recording-only tokens: read/upload/process positive cases, unrelated APIs/key administration/delete/cloud import denied, missing scope denied, inactive membership denied, owner isolation, selected-workspace isolation and contradictory hostname/header rejection. Test `/companion/session` returns only the user's eligible workspaces and safe identity fields.
- [ ] Run `pnpm --filter @savia/auth test test/oauth-native-client.test.ts` and `pnpm --filter @savia/api test test/companion-oauth-scopes.test.ts`; establish RED.
- [ ] Extend native registration validation explicitly; retain existing HTTP(S) normalization for legacy clients. Add recording scopes to issuer/resource configuration and authenticated API enforcement; broad existing scopes keep their existing behavior, but mobile requests never gain broad scopes implicitly. Factor the recording route lookup without expanding the personal-key allowlist to the new session endpoint.
- [ ] Implement the safe session endpoint using existing identity/membership repositories. Resolve the selected workspace with existing tenant context, and bind mobile recording access to that workspace without changing interactive legacy-recording access. Scoped OAuth requests must not silently access legacy records whose workspace cannot be established. Update generated OpenAPI security declarations for the new accepted scopes.
- [ ] Verify actual provider refresh rotation/revocation behavior using real Better Auth integration fixtures, including refresh replay failure and revoked grant rejection. If a provider default does not satisfy the approved contract, configure or implement it here; do not replace it with a success stub.
- [ ] Run focused auth/API tests plus existing `admin-oauth`, `better-auth`, personal-key and Companion isolation tests. Run both package typechecks and `pnpm --filter @savia/admin run generate:api`. Commit `feat: authorize native Companion clients with recording scopes`.

## Task 3: System-browser login and secure session lifecycle

**Files:** Create `lib/session/{session_controller,oauth_adapter,secure_session_store}.dart`, `test/session/session_controller_test.dart`; wire `lib/screens/connect_screen.dart`; modify Android manifest/Gradle callback configuration and `ios/Runner/Info.plist`/secure-storage entitlements.

**Interfaces:** `OAuthAdapter.authorize(): Future<TokenSet?>`, `refresh(String refreshToken): Future<TokenSet>`, `revoke(String refreshToken): Future<void>`; `TokenSet` carries access token/expiry and optional rotated refresh token. `SecureSessionStore.read/write/clear` handles only the refresh credential and issuer/client identity. `SessionController.signIn/restore/signOut`, `accessToken(): Future<String>`, `generation: int` and `setWorkspace(Workspace)` form the app session interface. Sign-out returns a typed revocation-warning outcome while always clearing local secrets/drafts.

- [ ] Write RED tests for cancelled login, invalid callback/state adapter failure, no persisted access token, one refresh for concurrent `accessToken()` calls, rotated refresh replacement, refresh failure requiring sign-in, and sign-out during an in-flight refresh leaving storage empty. Assert raw token values never appear in diagnostic strings.
- [ ] Run `flutter test test/session/session_controller_test.dart`; confirm failures against the missing implementation.
- [ ] Wrap flutter_appauth for system-browser PKCE and validate the configured issuer/redirect. Delegate protocol state/nonce/code verification to AppAuth, do not implement a second browser login flow. Implement serialized refresh and a generation counter so late login/refresh work cannot restore a signed-out session.
- [ ] Wrap flutter_secure_storage with device-local, non-synchronizing credential storage where supported; exclude credential/draft backup and document platform settings. Fetch available workspaces from Task 2 after login; keep workspace selection ephemeral and clear recording state on change.
- [ ] Add platform permission/callback declarations and tests for adapter cancellation outcomes. Run `flutter analyze` and session tests; verify native callback acceptance/rejection on emulator/device in Task 7. Commit `feat: add secure mobile Savia sessions`.

## Task 4: Typed recording API with cancellation and safe failures

**Files:** Create `lib/recordings/{models,recordings_api}.dart`, `test/recordings/recordings_api_test.dart`; define `lib/capture/draft.dart` shared draft value.

**Interfaces:** `RecordingDraft` has stable `id`, app-owned `path`, `name`, `format`, `bytes` and nullable duration. `RecordingsApi.session`, `list({cursor})`, `audio(id, destination, cancellation)`, `upload(draft, cancellation, onProgress)`, `notes(id)`, `generate(id,{required bool consent})`, `answer(id,question,{required bool consent})` return typed values matching the generated backend OpenAPI. A typed `CompanionFailure` retains only safe error code, HTTP status, fixed provider stage/status and unknown-outcome flag.

- [ ] Write failing mock-transport tests: correct bearer/workspace context, same draft ID on two explicit uploads, binary streaming instead of base64, 50,000,001-byte rejection before network access, cross-origin redirect rejection, cancellation, malformed JSON, missing scope and partial notes. Assert a POST receiving 401/timeout is called once rather than refreshed/replayed automatically.
- [ ] Run `flutter test test/recordings/recordings_api_test.dart`; establish RED.
- [ ] Implement the Dio transport without authenticated redirects, body logging or retry interceptors. Obtain/refresh the access token before dispatch; after a failed mutation preserve uncertainty and require explicit action. Decode the existing schema, including nullable durations/transcripts and `insufficientEvidence`; sanitize errors before exposing them to UI state.
- [ ] Use the draft UUID in the upload query and stream the local file with progress. Validate actual file length, supported extension/format and unchanged draft identity before sending; server content validation remains authoritative. Ensure cancelled requests stop reading the draft before cleanup.
- [ ] Run focused tests and `flutter analyze`; commit `feat: add scoped mobile recording API client`.

## Task 5: Foreground capture, document import and temporary draft lifecycle

**Files:** Create `lib/capture/{capture_controller,native_capture,document_import,temp_files}.dart`, `lib/screens/capture_screen.dart`, `test/capture/capture_controller_test.dart`, `test/screens/capture_screen_test.dart`; add microphone permission declarations to Android/iOS platform files.

**Interfaces:** `NativeCapture.start(path)` / `stop(): Future<CapturedFile>` / `cancel(): Future<void>` and a typed interruption stream; `DocumentImport.pick(): Future<PickedAudio?>`; `TempFiles.copyImport/createDraft/removeDraft/clearOrphans` operates only inside the app-owned temporary root. `CaptureController` exposes `idle/recording/ready/uploading/unknownOutcome/error` states and `start/stop/import/upload/discard/onBackground` actions, with one draft at a time.

- [ ] Write RED tests with fake clock/adapters: stop once at 60 seconds, permission denied without a draft, duplicate Start ignored, background/interruption stops capture, late picker result after sign-out discarded, cancelled picker leaves the source untouched, imported file over 50 MB rejected, and app-owned cleanup never removes the original source.
- [ ] Add unknown-upload-outcome test: timeout retains draft UUID and file; refresh finds the uploaded ID; only explicit retry can resubmit with that same ID. Assert confirmed upload cleans the draft after the request releases its file handle.
- [ ] Run the focused capture/controller widget tests and establish RED.
- [ ] Implement mono AAC/M4A using the record adapter, document picking through file_picker, and app-private temporary files through path_provider. Check actual encoder support; surface an unsupported-device outcome rather than silently writing a mislabeled file. Register lifecycle handling and visible 60-second limit/progress/consent copy; do not request background capture privileges.
- [ ] Implement explicit draft replacement/discard confirmation and cleanup on sign-out/startup. Keep selected user files read-only. Use the Task 4 uploader, including ambiguity state and cancellation teardown.
- [ ] Run tests/analyzer; build a native target where tooling permits to catch plugin manifest errors. Commit `feat: capture and import temporary mobile audio`.

## Task 6: Remote library, playback, notes and grounded questions

**Files:** Create `lib/recordings/recordings_controller.dart`, `lib/playback/audio_player_adapter.dart`, `lib/screens/{library,recording_detail}_screen.dart`, `test/recordings/recordings_controller_test.dart`, `test/screens/recording_detail_screen_test.dart`; extend locale ARB files and app composition.

**Interfaces:** `RecordingsController` consumes Tasks 3–5, exposes session-generation-bound library/detail state, and provides `reload/select/generate/ask/clear`. `AudioPlayerAdapter.openFile/play/pause/stop/dispose` owns playback only; temporary file cleanup occurs after native handles close. Errors remain descriptors translated during rendering.

- [ ] Write RED tests for server-driven restart/reload, cursor pagination, late list/detail/question result after workspace change/sign-out, playback cleanup, consent before processing, and questions disabled without a saved transcript.
- [ ] Add failure/recovery tests: summary failure rereads saved notes and preserves transcript; unsupported question displays insufficient evidence; answer clears when changing recording; provider errors and generic failures change with ES/EN/PT locale without another request. Double tapping Generate/Ask produces one request. No tasks or business writes occur.
- [ ] Run focused controller/widget tests and establish RED.
- [ ] Implement the screens and controllers with generation checks and cancellation. Download playback into the private temporary root via the authenticated client; verify codec support through just_audio and show a truthful unsupported-codec state. Do not create public audio URLs or a local library cache.
- [ ] Integrate all locales, semantics and scalable-text layouts; show Preview/account/workspace, current recording limit, temporary-draft status and provider error stage/status without raw details.
- [ ] Run `flutter test`, `flutter analyze` and focused semantics/large-text widget checks. Commit `feat: review and question recordings on mobile`.

## Task 7: Build automation, device evidence and preview integration

**Files:** Create `.github/workflows/companion-mobile.yml`, `integration_test/companion_smoke_test.dart`, `test/configuration_security_test.dart`; update `apps/companion-mobile/README.md`, `docs/companion/mobile.md`, `docs/README.md` and `docs/companion/implementation-status.md`.

**Interfaces:** CI runs the pinned Flutter SDK, analyzer/tests and Android debug build. iOS no-sign simulator build runs on an appropriately provisioned macOS runner; physical-device/signing results are separately recorded. Smoke accepts only a configured preview client/account and synthetic audio, and requires an explicit flag for paid processing.

- [ ] Add configuration tests that reject client/provider secrets in build configuration and forbid non-preview origins for this flavor. Add the opt-in smoke with assertions for sign-in, capture/import, one upload, app restart/retrieval, playback, persisted notes, supported question and insufficient evidence; keep ordinary CI independent of credentials and provider billing.
- [ ] Export the registered public client ID as `SAVIA_MOBILE_CLIENT_ID` (a public identifier, not a secret). Run `flutter analyze`, `flutter test`, `flutter build apk --debug --dart-define=SAVIA_MOBILE_CLIENT_ID="$SAVIA_MOBILE_CLIENT_ID"` and, with full Xcode, `flutter build ios --simulator --no-codesign --dart-define=SAVIA_MOBILE_CLIENT_ID="$SAVIA_MOBILE_CLIENT_ID"`. Missing client/toolchain/device/signing is a stated build or validation blocker, never a fabricated pass.
- [ ] Register the reviewed public native client in preview through the existing authorized management surface, using exact callback/scopes/grants and explicit consent. Record public client ID/build configuration without credentials. Follow the repository's reviewed main → CI → preview deployment flow for backend changes; do not enable production.
- [ ] Test on one Android and one iOS physical device when accessible: microphone permission denial/grant, interruption, app backgrounding, callback return, refresh/sign-out and supported playback. Keep fixtures separate from actual-device/provider evidence in the report.
- [ ] Run the controlled preview synthetic smoke only after authentication/provider access is available. If a provider or OS permission blocks completion, preserve the build/test results and state the exact unverified acceptance steps. Do not label the mobile flow validated solely from mocks.
- [ ] Review the combined diff and relevant auth/API regressions, generated OpenAPI, Flutter analyzer/tests and build artifacts. Commit `ci: validate Companion mobile builds and document evidence`; create/attach a PR using the repository workflow. App Store, TestFlight and Play publication remain excluded.

## Self-review and execution handoff

The seven tasks cover the approved spec; each has its own behavioral verification.
The session endpoint is the narrow discovery surface needed to select an eligible
workspace without granting mobile clients broad administrative read access.
Backend policy/auth work may be delegated separately from the initial Flutter
shell after Task 1 defines shared contracts. Session, API, capture and review
controllers are integrated in dependency order. At most two bounded workers may
run, with disjoint files; shared schema/generated-file changes are serialized.

Preserve the prior execution preference: implement inline in this task, delegate
bounded work when it improves isolation, and perform an independent final review.
This plan is ready for the user's review; no implementation has begun.

Package references checked while planning: [AppAuth](https://pub.dev/packages/flutter_appauth),
[secure storage](https://pub.dev/packages/flutter_secure_storage),
[record](https://pub.dev/packages/record), [file picker](https://pub.dev/packages/file_picker),
[playback](https://pub.dev/packages/just_audio). Resolve exact compatible stable
versions once in Task 1; the committed SDK pin and lockfile control later builds.
