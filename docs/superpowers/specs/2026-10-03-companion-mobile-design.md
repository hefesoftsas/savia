# Savia Companion mobile

Status: approved by the user on 2026-10-03; implementation plan under review.
Date: 2026-10-03.

## Intent and scope

Build an installable Flutter application for Android and iOS that lets Savia users
record through the microphone, import audio, explicitly upload it, review saved
transcripts and summaries, and ask questions grounded in a selected recording.
The user's approval is interpreted as choosing the recommended microphone/import
scope, not capture of WhatsApp, Teams, Zoom, phone calls or other applications.

Preserve the existing Tauri desktop application. Share Savia's backend and API
contracts; Flutter introduces a Dart client and mobile UI, not a rewrite of the
React admin application or the Rust desktop capture implementation.

First delivery targets internal preview validation. Store publication, production
enablement and claims of physical-device qualification are separate outcomes.

## Repository evidence

- `apps/companion` is a React/Tauri desktop validation app. Its current native
  sample capture is capped at 60 seconds and has platform-specific limitations.
- `apps/api/src/companion` already provides private recording persistence,
  binary imports, saved notes and consented transcript-grounded questions.
- Imports accept MP3, WAV, M4A and Ogg/Opus up to 50,000,000 bytes. Saving a file
  does not guarantee that the configured transcription provider can process it.
- Personal API keys already distinguish read, upload, process and delete scopes.
  These scopes are currently separate from the general OAuth scopes.
- `apps/auth/src/oauth.ts` supports authorization code/PKCE and refresh grants at
  provider level, but its management URL validator currently accepts HTTP(S)
  only, classifies HTTPS redirects as web clients, and creates clients with only
  the authorization-code grant. Mobile OAuth is therefore implementation work.
- Preview key authentication and web upload/persistence were validated. Real
  preview transcription, summary and Q&A remain unqualified: an earlier request
  returned 502, and the latest diagnostic deployment requires a fresh web login
  before another controlled provider test. Mobile must not conceal this blocker.

## App structure and screens

Create `apps/companion-mobile` as a Flutter project with Android and iOS targets.
Pin the Flutter SDK and Dart/package dependencies during implementation, commit
`pubspec.lock`, and document separate Flutter commands instead of pretending this
is a pnpm package. Keep generated API reference owned by the backend OpenAPI
pipeline; do not maintain a second handwritten API specification.

Use focused modules for session management, the typed HTTP client, temporary
capture/import, and recording review. Native integrations sit behind adapters so
unit/widget tests can simulate denial, interruption and network failures.

The initial screens are:

1. **Connect:** sign in to Savia through the system browser; preview identity is
   visible. Display the account/workspace and provide sign out.
2. **Recordings:** retrieve the owner's library from Savia, with explicit loading,
   empty, access-denied and unavailable states; offer Record and Import audio.
3. **Capture/review:** record, stop, play the local draft, discard or upload. The
   user sees the duration, size and whether audio has reached Savia.
4. **Recording details:** play saved audio, read transcript and structured notes,
   explicitly request processing, and ask questions after a transcript exists.

Use Savia's neutral surfaces, emerald accents and attribution. Provide Spanish,
English and Portuguese, accessible labels, scalable text and screen-reader
status announcements. Error messages must follow the current UI language.

## Authentication and authorization

Implement authorization code with PKCE S256 in the system browser, using a public
mobile client without an embedded client secret. Never collect the Savia password
inside Flutter or extract browser cookies. Use a registered reverse-domain callback
for the preview client, `com.hefesoft.savia.companion.preview:/oauth/callback`.
Android and iOS register exactly that callback. Production receives a separate
client and callback when production is intentionally enabled.

Extend auth registration for explicitly declared native public clients with exact
registered redirects, no wildcard/fragment/credentials, and PKCE required. Keep
existing admin/Scalar HTTP(S) validation and behavior unchanged. Request state and
PKCE verifier are ephemeral; reject unexpected, reused or mismatched callbacks.

Add recording-specific OAuth scopes alongside the existing general scopes.
The mobile client requests `openid`, `profile`, `offline_access`,
`recordings:read`, `recordings:upload` and `recordings:process`. Enforce these on
the backend using an explicit recording-route policy; they must not authorize
unrelated APIs or account/key administration. Do not silently fall back to broad
`savia.api.write`. Existing personal keys and existing web clients retain their
current contracts. Deletion and connected-drive import are excluded from mobile v1.

Use the existing authenticated workspace/membership resolution for OAuth requests.
Verify active membership, user ownership and selected workspace on every access;
changing workspace reloads the library and clears transient detail state. Keep
personal-key deployment/workspace binding unchanged. Verify the OAuth scope and
workspace integration with contract tests before connecting the mobile client.

Store only the refresh credential and the minimum required session identifiers
using native secure storage backed by iOS Keychain and Android Keystore. Access
tokens remain in memory. Configure refresh-token behavior and revocation through
the auth provider; test rotation/reuse failure and serialize refresh attempts.
Sign out revokes the refresh grant where supported and clears local credentials
and drafts. Revocation failure is reported; do not claim server revocation when
only local removal succeeded. A failed refresh requires sign-in again.

Preview builds use a fixed HTTPS origin and issuer. Do not accept arbitrary remote
origins or follow authenticated redirects to a different host. Credentials,
audio and transcripts never enter logs, analytics, URLs or crash reports.

## Capture, import and storage

Keep R2 and the existing backend as the source of truth for uploaded audio,
metadata, transcripts and notes. Do not introduce a local meeting database or
browser storage. Native secure credential storage is not a mirror of app data.

For the first validation increment, microphone capture is foreground-only and
limited to 60 seconds, visibly described as a short recording. Capture mono AAC
in an M4A container when supported by the chosen platform adapter; verify the
resulting files against the backend importer on both platforms. Stop/finalize on
interruption or app backgrounding, and report whether the resulting draft is
usable. Never silently continue microphone capture in the background.

Use the operating-system document picker for MP3, WAV, M4A and Ogg/Opus imports,
with the existing 50 MB maximum. Importing longer recordings does not remove
provider payload/timeout limitations. No file-system crawling or access to other
apps' private files is required. Inbound Share extensions and cloud-drive pickers
are later increments.

Keep at most one unsaved draft in the private app temporary directory. The
selected source file is never changed or deleted. Unsaved audio stays local until
Upload. Remove the app-owned draft after confirmed upload, explicit discard or
sign out; clean orphaned temporary drafts on startup. Explain that force-closing
can lose an unsaved draft. Do not claim crash recovery or secure erasure.

Upload through the existing binary import contract with progress and cancellation.
Allocate one UUID per draft and retain it for every explicit retry in that session.
The backend conditionally creates the object and compares content on same-ID
retries; never change the UUID merely because a request times out. If the result
is unknown, refresh the server library and show the ambiguity instead of blindly
creating another upload. No automatic retries for writes or paid operations.
Temporary playback files receive the same cleanup policy; list and note state is
refetched from Savia after restart.

## Processing and questions

Uploading alone never invokes the AI provider. Processing requires a separate
user action and consent. Retain the backend's partial-transcript recovery: if
summary generation fails, reload saved notes rather than retranscribing audio.
Present the fixed processing stage and upstream HTTP status when available, with
provider-usage guidance before another explicit attempt.

Only enable questions when a saved transcript exists. Send the selected recording
identifier and question; let the backend supply the transcript and configured
model. Clearly display insufficient evidence. Answers remain temporary drafts,
clear on recording/workspace change, and do not create tasks or business records.
Do not add automatic retries or a second mobile implementation of AI prompting.

## Validation and delivery

Implementation proceeds through independently verifiable slices:

1. Flutter shell and backend client with fixture-based unit/widget tests.
2. Native-public OAuth registration, recording OAuth scope enforcement, secure
   session adapter and callback/refresh integration tests.
3. Microphone/document-picker adapters and explicit upload with interruption,
   permission-denied, unsupported-format, size-limit and cancellation handling.
4. Library, playback, saved notes, processing and grounded questions using the
   existing backend; localized error and consent tests.
5. Internal Android build, iOS build where tooling permits, and real-device smoke
   evidence on each platform before claiming capture/upload support there.

Acceptance requires a real account to sign in, record/import synthetic audio,
upload it once, restart the app, retrieve/play it, generate saved notes, and ask
both an answerable and unsupported question. Also verify cross-user/workspace
isolation, scope denials, revocation, expired-session handling and absence of
provider secrets in the build. Unit mocks do not establish provider availability.
A successful simulator build does not establish physical-device audio behavior.

The inspected shell has neither Flutter nor Dart on PATH; the active Apple tools
path is `/Library/Developer/CommandLineTools`, which does not establish a usable
full Xcode/iOS setup. Locate existing SDK installations before installing anything.
Document actual build/device/signing limitations. Never claim a signed IPA,
TestFlight upload, Play release or production deployment from a debug build.

## Explicit exclusions

Other-app/call capture; background/locked-screen recording; long microphone
sessions; offline library or upload queue; resumable/chunked uploads; background
AI jobs; push notifications; diarization; shared recordings; persistent Q&A
history; deletion UI; inbound share extensions; store publication. These are not
hidden requirements of the first internal mobile validation build.

## References

- [Flutter architecture](https://docs.flutter.dev/resources/architectural-overview)
- [Flutter iOS setup](https://docs.flutter.dev/platform-integration/ios/setup)
- [OAuth for native apps, RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252)
- [Recording imports](../../companion/recording-imports.md)
- [Personal API keys](../../guides/personal-api-keys.md)
- [Live validation evidence](../../companion/live-flow-smoke.md)
