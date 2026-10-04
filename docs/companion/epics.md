# Savia Companion validation roadmap

Owner: Savia platform maintainers. Reviewed: 2026-10-01.

**Status:** long-term roadmap. A bounded desktop/API validation increment is implemented; see [story and gate status](implementation-status.md). Production qualification remains pending.

This document describes a possible long-term validation program for Savia Companion, a desktop meeting-capture client. It is a planning artifact, not a statement that these capabilities exist or that a release date, budget, or delivery commitment has been approved. The initial workspace, WAV inspector and documentation foundation have been verified. Native/service code now exists in a bounded validation increment; hardware/provider evidence remains pending.

## Product and architecture boundaries

The current candidate is a Tauri 2 desktop application with a React and TypeScript UI and a Rust native host. It should capture a user's explicitly selected system audio and microphone, prepare valid audio chunks, and submit them to Savia for transcription. The first platform targets are macOS 14.2 and later, using CoreAudio taps plus microphone capture, and Windows 11, using WASAPI loopback plus microphone capture. Windows 10 is a separate compatibility investigation and is not implied by Windows 11 support. Linux is a later decision, not part of the initial acceptance scope.

Capture source is metadata about where audio entered the client. It does not identify speakers: a system-audio stream can contain several remote participants, while a microphone stream can contain local speech and environmental sound. Speaker diarization, when available and lawful for the selected provider and model, is an inference attached to transcript segments and must be represented with confidence and limitations.

Savia remains authoritative for user identity, tenant and record authorization, meeting/job state, durable transcript data, and R2 media objects. The desktop client is not a substitute for Savia ACL checks. It must not place general application state or meeting history in browser localStorage or IndexedDB. A narrowly scoped temporary native encrypted spool may be considered for crash recovery or explicit offline operation; that exception requires bounded retention, clear user controls, and verified purge behavior.

The endpoint-specific transcription approach in this roadmap is superseded by the current [model configuration](model-configuration.md), which uses OpenRouter chat completions with audio input. The following endpoint discussion describes the original validation candidate, not the current implementation. Its documented audio transcription route is `POST /api/v1/audio/transcriptions`, accepts multipart audio, and documents a 25 MB limit. The project must identify transcription capability independently from text-generation capability. It must test actual providers and models for Spanish, timestamps, diarization, accepted container/codec combinations, and limits. Provider privacy-routing controls must be treated as unavailable until verified for this modality and route. Provider request timeouts (including the documented 60-second upstream processing timeout) are distinct from recording duration; long meetings require chunked jobs and asynchronous lifecycle handling.

Meeting media must be partitioned into valid, independently decodable container files with a shared meeting timeline and separate microphone/system source tracks where supported. Chunk uploads need deterministic identifiers, retry deduplication, bounded concurrency, explicit accounting, and protection against duplicate provider charges. The existing Cloudflare upload path's `arrayBuffer()` buffering is unsuitable for large media; a bounded streaming design is required against Cloudflare Workers' 128 MB memory limit. A Queue binding does not currently exist for this feature and must be explicitly provisioned if the selected job architecture uses Queues.

Summaries and extracted facts are separate background work after transcription. They should return structured candidate facts, decisions, and tasks with transcript-time evidence and source references. They must not create or update Savia business records, send messages, or otherwise write externally without an explicit later human-approved action. Summary generation must not block transcript persistence or make transcription appear successful when it failed.

## Roadmap order and critical path

The intended dependency path is **CMP-00 → CMP-01 → CMP-02 → CMP-03/CMP-04 → CMP-05 → CMP-06 → CMP-07 → CMP-08 → CMP-09 → CMP-10 → CMP-11**. Platform capture work can proceed in parallel only after the consent contract and host boundary are agreed. CMP-10 may be feature-flagged or deferred without blocking a capture-and-transcript pilot. CMP-11 release packaging and qualification is a gate for any public distribution.

CMP-00 is complete for the documented scaffold scope. CMP-01 through CMP-11 are partially implemented or planned as detailed in the status document. Their acceptance criteria define evidence to collect, not completed evidence. Every test/evidence item must be produced on the actual supported operating system and hardware class; mocked audio or provider stubs alone cannot pass a platform or end-to-end gate.

## CMP-00 — Validation workspace and research baseline

**Goal:** establish a reviewable, evidence-led Companion project area before implementation begins.

**Dependencies:** none.

**Deliverables:** `apps/companion` research/scaffold workspace; `docs/companion/README.md`, architecture, validation, and research documentation; this roadmap. The workspace, inspector tests and documents were reviewed and verified in this increment. No production capture, backend endpoint, provider integration, or installer is part of this epic.

### Stories

**CMP-00.1 — Create an isolated Companion workspace.**

- Acceptance criteria: the workspace location and intended package/toolchain boundaries are documented; it is clearly identified as exploratory and does not imply release readiness; the existing Savia application remains the authority for persisted business state.
- Tests/evidence: inspect the workspace tree and package metadata; run only scaffold-level validation that the primary owner considers applicable; record commands and outcomes in the project notes.

**CMP-00.2 — Record architecture candidates and unresolved questions.**

- Acceptance criteria: docs identify Tauri 2, React/TypeScript, Rust, target OS versions, audio source separation, Savia backend ownership, provider boundary, and known API/runtime constraints; assumptions are visibly separated from verified facts.
- Tests/evidence: review links and claims against primary project documentation or runnable probes; list unresolved provider, OS, and hardware questions rather than filling gaps with assumptions.

**CMP-00.3 — Define a repeatable validation record.**

- Acceptance criteria: documentation specifies how to record OS/build, devices, provider/model, sample length, transcript output, latency, failures, and privacy settings; test audio is clearly identified and permitted for use.
- Tests/evidence: a reviewer can follow the document to reproduce a manual baseline and distinguish simulated results from native-device results.

**CMP-00.4 — Audit reusable code before import.**

- Acceptance criteria: any selected upstream code has an immutable revision, file-level license map, transitive dependency inventory and preserved notices; commercial enterprise paths are excluded; this foundation imports no capture code and inherits Savia's existing repository license.
- Tests/evidence: review the provenance ledger and dependency license inventory before copy or dependency installation.

**Risks:** a scaffold can be mistaken for a working product; incomplete primary documentation can cause later decisions to be treated as established.

**Exit gate:** passed for the scaffold/documentation scope: the workspace is registered in the lockfile, its five inspector tests and CLI help pass, and documentation contains explicit implementation limits. Native and provider gates remain pending. The upstream import audit is deferred until a dependency or copied implementation is actually selected; this increment imports none.

## CMP-01 — Product scope, consent, and data policy

**Goal:** agree what Companion captures, when capture is visible, what users and meeting participants are told, and how media/transcripts are retained before building recording flows.

**Dependencies:** CMP-00 reviewed.

**Deliverables:** approved product contract, consent/indicator UX, retention and deletion policy, data-flow/threat notes, explicit out-of-scope list.

### Stories

**CMP-01.1 — Define recording scope and user controls.**

- Acceptance criteria: capture begins only through an explicit user action; the UI persistently indicates active capture and shows selected sources; pause, resume, stop, and discard behavior is specified; no silent auto-start or background meeting joining is introduced.
- Tests/evidence: product review of start/pause/resume/stop/discard states; interaction prototype or UI tests show the indicator stays present during capture and survives navigation/minimization.

**CMP-01.2 — Define participant notice and consent workflow.**

- Acceptance criteria: product copy tells the operator what is captured, where processing occurs, which provider is selected, and how to stop/delete; the project records the user's responsibility to follow applicable meeting and organizational consent rules; no legal sufficiency claim is made without jurisdictional review.
- Tests/evidence: product/legal review record for target launch jurisdictions; usability evidence shows the notice and provider choice are available before capture or upload.

**CMP-01.3 — Specify media and transcript lifecycle.**

- Acceptance criteria: policy distinguishes temporary local media, uploaded R2 objects, transcript segments, extracted summaries, provider retention, and deletion; retention defaults and user/admin deletion paths are stated; provider route privacy controls remain “unverified” until tested.
- Tests/evidence: data inventory and deletion-path walkthrough covers each store, including provider and backup limitations.

**CMP-01.4 — Define prohibited inferences and output handling.**

- Acceptance criteria: source track is never presented as speaker identity; diarization is labeled as inferred; summary facts, decisions, and tasks cite transcript time ranges; automated external writes and sending are excluded unless separately approved by a user.
- Tests/evidence: product review against sample output with overlapping speakers, uncertain diarization, and unsupported action statements.

**Risks:** consent and recording indicators vary across platforms and jurisdictions; provider policies can change; unclear deletion semantics can make a technically successful recorder unacceptable.

**Exit gate:** product owner accepts capture/consent behavior, retention categories, and provider-routing decision criteria; outstanding legal questions are assigned before pilot use.

## CMP-02 — Desktop shell, identity, and native security boundary

**Goal:** establish a small, auditable Tauri host that can authenticate to Savia while keeping privileged audio and file operations in narrowly scoped Rust commands.

**Dependencies:** CMP-01; CMP-00 workspace verified.

**Deliverables:** desktop shell, typed UI/host IPC, login/session handoff, secret storage design, permission manifest and threat review.

### Stories

**CMP-02.1 — Define the Tauri capability boundary.**

- Acceptance criteria: UI code cannot invoke arbitrary shell, filesystem, process, or network functions; each privileged command is explicitly allowlisted and validates its inputs; production CSP and navigation policy reject untrusted origins.
- Tests/evidence: inspect Tauri capability/configuration files; negative tests attempt unlisted commands, external navigation, path traversal, and malformed IPC arguments.

**CMP-02.2 — Integrate Savia sign-in and session lifecycle.**

- Acceptance criteria: the client obtains identity through Savia's supported auth flow; tokens are stored only in operating-system credential storage or an approved secure mechanism; sign-out/revocation clears access and blocks further upload; tenant ID is not accepted as a client-supplied authority claim.
- Tests/evidence: sign-in/sign-out/revocation test against a Savia test tenant; inspect process logs and disk state to ensure tokens are not written to logs or plain files.

**CMP-02.3 — Define native temporary-file handling.**

- Acceptance criteria: any temporary audio path is generated and controlled by the native host, inaccessible to renderer-selected arbitrary paths, and covered by an explicit cleanup lifecycle; browser localStorage and IndexedDB are not used for media, credentials, meeting state, or recovery state.
- Tests/evidence: filesystem inspection after success, error, app restart, and sign-out; static search for forbidden browser persistence APIs in Companion code.

**CMP-02.4 — Set diagnostic and update boundaries.**

- Acceptance criteria: diagnostics exclude audio, transcripts, credentials, meeting titles, and raw provider responses by default; any opt-in report is previewable and redacted; updater/package signing decisions are documented before public distribution.
- Tests/evidence: inspect sample logs and diagnostic export; automated redaction tests cover tokens and transcript-like text.

**Risks:** desktop auth token handling, renderer-to-native IPC, and auto-update compromise have broad impact; OS keychain APIs differ.

**Exit gate:** security review approves the privilege surface and auth lifecycle; no unresolved high-severity boundary issue remains before capture permissions are added.

## CMP-03 — macOS capture (14.2+)

**Goal:** capture system output through CoreAudio taps and microphone input on supported macOS versions, with explicit permissions and user-visible state.

**Dependencies:** CMP-02; CMP-01 consent contract.

**Deliverables:** native capture implementation, permission/denial UX, separate source tracks, supported-device coverage.

### Stories

**CMP-03.1 — Validate CoreAudio tap feasibility and entitlement path.**

- Acceptance criteria: a native proof of concept on macOS 14.2+ records permitted system output without capturing before the user starts; required API availability, entitlements, signing, and privacy prompts are documented; unsupported versions fail closed with an understandable message.
- Tests/evidence: signed local build exercised on clean macOS 14.2+ installations; record permission grant/deny/revoke behavior and sample capture provenance.

**CMP-03.2 — Capture microphone independently.**

- Acceptance criteria: microphone permission is requested when needed; selected input and system output remain separate audio streams; disabling either source is respected; source metadata is not described as speaker attribution.
- Tests/evidence: native loopback test with distinct tones on input/output verifies separate track content and mute behavior.

**CMP-03.3 — Handle device changes during a meeting.**

- Acceptance criteria: disconnect, re-pair, default-device change, and Bluetooth route changes are detected; the user is informed of gaps or route changes; the client does not silently switch to an unintended input.
- Tests/evidence: hardware coverage for wired, built-in, and Bluetooth devices with unplug/reconnect and route switch during a recording.

**CMP-03.4 — Validate capture isolation and stop behavior.**

- Acceptance criteria: stopping releases taps and microphone streams, stops temporary writes, and removes active-capture indicators; app failure or OS permission revocation produces a visible interrupted state and no falsely continuous timeline.
- Tests/evidence: repeated start/stop, app force-quit, permission revocation, sleep/wake, and device-loss runs with resource and output-file inspection.

**Risks:** CoreAudio tap API behavior, OS permissions, signing, and audio devices may differ across macOS point releases; system audio can contain mixed remote speakers.

**Exit gate:** native tests pass on the declared macOS range and listed device classes; gaps, unsupported conditions, and resource behavior are documented.

## CMP-04 — Windows capture (Windows 11 first)

**Goal:** capture Windows system output using WASAPI loopback and microphone independently on Windows 11; treat Windows 10 support as a separate research decision.

**Dependencies:** CMP-02; CMP-01 consent contract.

**Deliverables:** WASAPI capture adapter, device/permission UI, Windows 11 hardware evidence, Windows 10 decision record.

### Stories

**CMP-04.1 — Validate WASAPI loopback on Windows 11.**

- Acceptance criteria: capture is user-triggered and stops predictably; loopback and microphone tracks remain independently switchable; supported endpoint and format constraints are surfaced; capture does not imply participant identity.
- Tests/evidence: Windows 11 native tests across built-in and USB output endpoints; verify source routing with distinct test signals.

**CMP-04.2 — Handle microphone permissions and device churn.**

- Acceptance criteria: OS privacy settings and denial are explained; endpoint removal/default changes and Bluetooth transitions are handled without a false “recording normally” state; user can choose a supported endpoint.
- Tests/evidence: clean-account permission tests; disconnect/reconnect and default-device changes; headset, speaker, and microphone combinations.

**CMP-04.3 — Decide Windows 10 support independently.**

- Acceptance criteria: Windows 10 is either explicitly excluded with a user-facing minimum version or supported only after a separate technical, security, and lifecycle review; no Windows 11 evidence is extrapolated to Windows 10.
- Tests/evidence: decision record includes OS edition/build, API availability, device coverage, and maintenance cost; if supported, run the same core capture suite on declared builds.

**CMP-04.4 — Qualify capture interruption paths.**

- Acceptance criteria: sleep/wake, audio service restart, default device change, and app termination produce detectable gaps and recoverable state; stop cleans native resources.
- Tests/evidence: automated and manual interruption runs on clean Windows 11 images with resulting tracks and logs inspected.

**Risks:** WASAPI endpoint behavior and Bluetooth profiles vary; Windows 10 servicing status is a separate product and support decision.

**Exit gate:** Windows 11 capture passes the agreed test cases; Windows 10 status is explicitly decided and must not be implied by the installer target.

## CMP-05 — Shared timebase, audio quality, and capture resilience

**Goal:** keep microphone and system tracks aligned, intelligible, and accurately represented through device changes and long sessions.

**Dependencies:** CMP-03 and CMP-04 for platform adapters.

**Deliverables:** canonical sample-rate/format policy, timestamp model, conversion/resampling pipeline, gap markers and recovery behavior.

### Stories

**CMP-05.1 — Establish one monotonic meeting timeline.**

- Acceptance criteria: every audio frame/chunk maps to a monotonic meeting offset; wall-clock timestamps are supplementary and cannot introduce negative/reordered offsets; source track start/end and gaps are preserved.
- Tests/evidence: deterministic synthetic clock tests, including wall-clock adjustment, process suspension, and cross-track alignment.

**CMP-05.2 — Resample and format tracks explicitly.**

- Acceptance criteria: each supported device format is converted through a documented pipeline to the declared upload formats; channel layout, sample rate, bit depth, and conversion status are stored; conversion errors fail visibly rather than silently corrupting timing.
- Tests/evidence: fixtures at varied rates/channel counts, codec/container validation, and audio-quality comparisons before and after conversion.

**CMP-05.3 — Bound drift and synchronization error.**

- Acceptance criteria: the team defines measurable drift and skew tolerances before the test is considered passing; drift correction preserves the original timeline and does not discard audio silently; skew beyond tolerance is surfaced.
- Tests/evidence: long-duration dual-source tests on real devices, including Bluetooth and USB; report measured offset and drift over duration.

**CMP-05.4 — Detect echo and capture feedback.**

- Acceptance criteria: system output monitoring identifies likely feedback/echo cases and offers safe guidance; any suppression is explicit and does not rewrite source tracks without recording the transformation; no promise of echo cancellation is made without measured evidence.
- Tests/evidence: test scenarios using speakers, headphones, conferencing apps, and loopback; compare raw and processed output where applicable.

**Risks:** clocks can drift independently; Bluetooth may change codec or endpoint mid-session; echo behavior depends on conferencing app and hardware.

**Exit gate:** declared synchronization tolerances pass across supported devices on both OSes, including long-session and route-change runs.

## CMP-06 — Valid chunk containers and upload-ready media

**Goal:** emit interoperable, independently decodable chunks with shared timing metadata and bounded memory use.

**Dependencies:** CMP-05.

**Deliverables:** container/codec selection, chunk boundary policy, track manifest, size and integrity metadata, format compatibility evidence.

### Stories

**CMP-06.1 — Select supported container and codec combinations.**

- Acceptance criteria: formats are selected based on tested local decoders, chosen STT providers, R2/object requirements, and legal/dependency review; no unsupported multipart formats are assumed to be accepted; format and encoder parameters are versioned.
- Tests/evidence: compatibility table includes OS, codec, sample rate, channels, container, provider/model, and result.

**CMP-06.2 — Make each chunk a valid independent media object.**

- Acceptance criteria: each chunk can be opened and decoded without hidden initialization state from a preceding chunk; chunk boundaries include timing and any required overlap/padding metadata; overlap does not result in duplicate transcript text without an explicit reconciliation rule.
- Tests/evidence: decode every chunk in isolation with independent media tooling; boundary fixtures include silence, continuous speech, and speech crossing a boundary.

**CMP-06.3 — Maintain separate tracks and a shared manifest.**

- Acceptance criteria: microphone/system source identifiers remain separate; every uploaded object maps to meeting-relative start/end, sequence, format, and checksum; metadata never labels track as a person.
- Tests/evidence: validate manifest against known two-source recordings and reconstructed alignment; reject missing, duplicate, and out-of-order sequence metadata.

**CMP-06.4 — Stay within memory and provider upload bounds.**

- Acceptance criteria: media is chunked before upload to satisfy the selected provider and Cloudflare limits; no full-file `arrayBuffer()` path is used for unbounded uploads; backpressure and configured maximum chunk sizes are enforced.
- Tests/evidence: large-file tests observe peak memory; payloads at and beyond documented 25 MB provider limit verify bounded rejection/chunking behavior and avoid 128 MB Worker memory exhaustion.

**Risks:** supported media formats can differ between OpenRouter's endpoint and individual models; container headers, resampling, and overlap affect transcription quality and cost.

**Exit gate:** all chunks decode independently, reconstruct on a shared timeline, fit declared limits, and pass representative provider compatibility checks.

## CMP-07 — STT provider adapter and policy validation

**Goal:** implement a narrow asynchronous provider adapter with explicit capability discovery, cost/idempotency controls, and verified privacy behavior.

**Dependencies:** CMP-06; CMP-01 provider/privacy policy.

**Deliverables:** provider-neutral job contract, OpenRouter candidate adapter, capability coverage, rate/timeout/error policy, secret management.

### Stories

**CMP-07.1 — Verify transcription modality independently from text models.**

- Acceptance criteria: discovery checks provider/model support for audio transcription separately from chat/completions; exact route, multipart field names, supported model IDs, Spanish output, timestamps, diarization, and file types are recorded; unsupported combinations are not advertised.
- Tests/evidence: live tests against authorized provider accounts and named models; preserve redacted request/response fixtures and date/version of verification.

**CMP-07.2 — Implement bounded asynchronous request behavior.**

- Acceptance criteria: provider timeout policy is configurable and does not constrain full-meeting length; per-chunk requests support cancellation and typed retryable/non-retryable failures; concurrency/rate limits and exponential backoff have hard bounds.
- Tests/evidence: simulated provider delay, timeout, 429, 5xx, malformed response, cancellation, and partial meeting failures; verify job state remains truthful.

**CMP-07.3 — Make retries idempotent and costs observable.**

- Acceptance criteria: Savia assigns stable operation IDs and records provider/model/chunk attempt, status, and cost metadata where available; a retry cannot silently create duplicate transcript segments or an untracked second charge; ambiguous provider outcomes enter reconciliation state.
- Tests/evidence: duplicate delivery/retry tests and provider timeout-after-acceptance simulation; compare billing/usage metadata and transcript rows.

**CMP-07.4 — Verify privacy routing and provider data handling.**

- Acceptance criteria: routing choices are exposed only if the transcription route and selected model honor them; otherwise UI and architecture state that routing/privacy control is unavailable; retention, training, and deletion claims are based on current provider terms and configuration evidence.
- Tests/evidence: provider documentation and account/config probes, security review, and dated record; no inference from text-generation behavior to audio transcription.

**CMP-07.5 — Protect provider credentials.**

- Acceptance criteria: keys are never embedded in the desktop bundle or saved in renderer storage; server-side account keys stay in managed secret storage; any future BYOK flow has a separate threat and tenant-isolation review.
- Tests/evidence: build artifact scan, network/log redaction checks, secret rotation and revocation tests.

**Risks:** model/endpoint support and provider terms may change; retries can incur duplicate charges; provider latency and rate limits vary under load.

**Exit gate:** named providers/models pass modality, Spanish, output schema, size, timeout, cost, and privacy-policy checks; all unsupported options are hidden or clearly unavailable.

## CMP-08 — Savia authorization, queue, storage, and transcript jobs

**Goal:** make Savia's backend the sole durable authority for meetings, jobs, access checks, transcripts, and uploaded media.

**Dependencies:** CMP-02 authentication; CMP-06 media manifest; CMP-07 provider adapter.

**Deliverables:** generated API contract, explicit Queue binding or selected alternative, D1 job/meeting state, R2 objects, authorization checks, streaming upload path.

### Stories

**CMP-08.1 — Model meeting, upload, and transcript job ownership.**

- Acceptance criteria: schemas link each meeting/job/object/transcript to an authenticated Savia principal and tenant; client-supplied tenant identifiers cannot widen access; authorization is checked on create, upload, polling, read, and delete; migrations preserve existing Savia data behavior.
- Tests/evidence: API authorization coverage across two tenants, member roles, ownership changes, deletion, and revoked sessions; migration and schema review.

**CMP-08.2 — Define durable job states and partial outcomes.**

- Acceptance criteria: state machine represents queued, capturing/uploading, transcribing, partial, complete, cancelled, failed, and expired states as appropriate; retries and duplicate callbacks cannot regress terminal states; partial chunks and provider failures remain visible to users.
- Tests/evidence: transition/property tests, concurrent update tests, duplicate message tests, and failure-injection review.

**CMP-08.3 — Provision and validate background execution.**

- Acceptance criteria: if Cloudflare Queues is selected, binding, environments, consumer limits, retries, dead-letter policy, and deployment secrets are explicitly added; if not, the alternative's durability and retry guarantees are documented; no existing queue binding is presumed.
- Tests/evidence: environment config and deployed binding inspection; local and staging end-to-end job execution, redelivery, poison message, and drain tests.

**CMP-08.4 — Stream uploads to R2 without large Worker buffering.**

- Acceptance criteria: request bodies stream or use a documented direct-upload protocol; authorization and signed URL scope are bounded to one tenant/object; size, content type, checksum, and expiration are validated; current `arrayBuffer()` handling is not reused for unbounded media.
- Tests/evidence: large upload tests on the actual Worker path with memory metrics, interrupted-transfer recovery, checksum verification, unauthorized cross-tenant URL tests, and cleanup tests.

**CMP-08.5 — Persist transcript segments and source evidence.**

- Acceptance criteria: segments store job/meeting, start/end offsets, source track, text, provider/model/version, confidence/diarization fields where supported, and provenance; outputs are escaped/sanitized on display; deletion follows the accepted retention policy.
- Tests/evidence: schema/API integration tests, malicious transcript content rendering checks, ordering/idempotency tests, R2/D1 deletion walkthrough.

**CMP-08.6 — Generate rather than hand-write API references.**

- Acceptance criteria: public/backend interfaces update the repository's OpenAPI/Scalar generation source and generated documentation workflow; this roadmap does not substitute for API reference documentation.
- Tests/evidence: generated spec diff and API doc generation check in the implementation phase.

**Risks:** Cloudflare streaming/runtime constraints, queue redelivery, cross-tenant object authorization, and media retention interact; provider calls may outlive individual request lifetimes.

**Exit gate:** end-to-end staging flow passes with cross-tenant denial, large streamed upload, durable queue/recovery evidence, idempotent segments, and documented cleanup.

## CMP-09 — Crash recovery, offline operation, and native encrypted spool

**Goal:** recover from interrupted capture or network loss without losing track of unsent audio, expanding persistence into general client-side state, or retaining recordings indefinitely.

**Dependencies:** CMP-01 retention; CMP-02 native storage boundary; CMP-05 timeline; CMP-08 job lifecycle.

**Deliverables:** bounded encrypted spool, recovery UX, retry/resume protocol, retention/expiry and secure purge evidence.

### Stories

**CMP-09.1 — Define the narrow spool exception.**

- Acceptance criteria: spool purpose is limited to crash recovery or explicit offline capture; contents are encrypted at rest with OS-protected keys; size and age limits, ownership, exclusion from backups where feasible, and user-visible status are defined; it does not store arbitrary application or meeting state.
- Tests/evidence: threat review and on-disk inspection on both operating systems; verify encryption/key isolation and defined capacity limits.

**CMP-09.2 — Resume by deterministic chunk identity.**

- Acceptance criteria: after restart or connectivity recovery, the client asks Savia which chunks are accepted and only resends missing chunk IDs; meeting timeline and idempotency survive process restart; user can choose discard instead of resume.
- Tests/evidence: kill/restart at each capture/upload/transcribe boundary, replay duplicate acknowledgements, and verify no duplicate audio/transcript or hidden new provider charge.

**CMP-09.3 — Handle offline transitions explicitly.**

- Acceptance criteria: network loss changes UI state and explains whether capture continues, pauses, or stops under the product policy; size exhaustion and session maximum result in an explicit action; reconnection cannot silently restart capture or change provider choice.
- Tests/evidence: network disconnect/reconnect, DNS failure, server outage, disk full, and long offline tests with user-visible state recorded.

**CMP-09.4 — Purge temporary media deterministically.**

- Acceptance criteria: successful upload, discard, cancellation, expiration, logout, uninstall, and recovery failure each have documented spool cleanup outcomes; purge is retryable and failures are visible; no general localStorage/IndexedDB fallback is introduced.
- Tests/evidence: filesystem and keychain inspection after each lifecycle path, including forced termination and power-loss simulation where available.

**Risks:** local copies increase privacy impact; secure deletion on modern storage is not guaranteed; user expectations for offline recording may conflict with disk/retention limits.

**Exit gate:** cross-platform crash/network test cases demonstrate bounded encrypted retention, correct resumption, reliable purge attempts, and honest failure states.

## CMP-10 — Transcript review, diarization, and structured meeting outcomes

**Goal:** present provider output with provenance and uncertainty, then optionally derive evidence-linked summaries as independent background work.

**Dependencies:** CMP-08 transcript persistence; CMP-07 verified provider/model capabilities; CMP-01 output policy.

**Deliverables:** transcript review UI, diarization presentation contract, background summary job/schema, evidence-linked decision/task suggestions.

### Stories

**CMP-10.1 — Build transcript playback and correction surface.**

- Acceptance criteria: transcript segments align to meeting time and playable media; source tracks can be identified without being conflated with people; user edits are attributed and versioned; provider output remains distinguishable from human correction.
- Tests/evidence: UI tests for seek/alignment, partial transcript, correction history, deleted media, and accessibility/keyboard review.

**CMP-10.2 — Add capability-dependent diarization.**

- Acceptance criteria: diarization is available only when the selected provider/model returns supported speaker data; each label is explicitly inferred and can be unknown; source-track labels are never substituted for person labels; changing provider/model preserves provenance.
- Tests/evidence: overlap, crosstalk, unknown speaker, single-speaker, and provider-without-diarization fixtures; compare output to human-labeled consented evaluation set and report limitations.

**CMP-10.3 — Run structured summaries as separate background jobs.**

- Acceptance criteria: summary job does not block or change transcription success; output schema distinguishes summary, facts, decisions, and tasks; each candidate includes transcript time evidence and confidence/uncertainty; unsupported fields fail validation visibly.
- Tests/evidence: schema validation and sampled human review for hallucination rate, missed attribution, and evidence correctness; retry and provider failure tests.

**CMP-10.4 — Require human action for business writes.**

- Acceptance criteria: generated decisions/tasks are suggestions only; no automatic Savia record mutation, notifications, email, external integration, or participant follow-up occurs; any later action has an explicit preview, authorization, and confirmation contract.
- Tests/evidence: negative integration tests assert no write side effects from transcript/summary generation; audit user-confirmed actions separately if implemented.

**Risks:** diarization errors can misattribute speech; summarization can invent commitments or omit dissent; generated suggestions can be mistaken for verified business facts.

**Exit gate:** transcript provenance and corrections are traceable; optional AI outputs pass evaluation thresholds approved by product and remain non-mutating until human confirmation.

## CMP-11 — Qualification, installers, operations, and release gate

**Goal:** determine whether the Companion is safe and supportable to distribute on its declared platforms.

**Dependencies:** CMP-02 through CMP-10 for any capability included in the release; CMP-01 product/privacy approval.

**Deliverables:** signed and notarized packages where required, release/update process, operational metrics and runbooks, regression suite, explicit support coverage and go/no-go record.

### Stories

**CMP-11.1 — Produce signed platform installers.**

- Acceptance criteria: macOS packages are signed/notarized and pass Gatekeeper on a clean machine; Windows packages are signed under the approved release identity; build provenance and dependencies are recorded; unsupported platforms are blocked or labeled.
- Tests/evidence: install/upgrade/uninstall tests on clean supported OS versions, signature verification, and reproducible release artifact checks.

**CMP-11.2 — Secure the update channel.**

- Acceptance criteria: updater metadata and artifacts are authenticated; rollback/failure leaves the installed app recoverable; update prompts do not start capture or submit data; release notes describe privacy-meaningful changes.
- Tests/evidence: tampered manifest/artifact rejection, interrupted update, rollback, and version-skew regression runs.

**CMP-11.3 — Add privacy-preserving operational telemetry.**

- Acceptance criteria: telemetry records only necessary counts, state transitions, durations, error classes, and cost aggregates; it excludes audio, transcripts, credentials, and meeting titles; collection, retention, and opt-out follow CMP-01.
- Tests/evidence: event-schema inspection and packet/log review on successful and failed sessions; prove no payload or secret leakage.

**CMP-11.4 — Complete end-to-end validation and support runbooks.**

- Acceptance criteria: test cases cover supported OS versions, hardware, device switching/Bluetooth, permission denial, long sessions, clock drift, echo, crash, network interruption, queue/provider failure, Spanish quality, deletion, and tenant isolation; each supported claim cites an evidence record; owners and dates exist for operational procedures.
- Tests/evidence: run the published test cases on actual hardware and a staging tenant; preserve redacted evidence; run restore/deletion and cost reconciliation drills.

**CMP-11.5 — Make an explicit release decision.**

- Acceptance criteria: release decision names included capabilities, known limitations, privacy/provider settings, supported OS/hardware, unresolved risks, and rollback owner; no roadmap status or mocked test is described as production evidence; release is blocked by unresolved critical security/privacy findings.
- Tests/evidence: signed go/no-go review record and release checklist linked to actual run outputs.

**Risks:** code signing credentials and updater compromise; coverage breadth; silent changes in OS/provider behavior; privacy claims that cannot be supported by current provider evidence.

**Exit gate:** approved evidence exists for every release claim, installers pass clean-machine tests, operations and deletion procedures are rehearsed, and product/security owners explicitly approve the release.

## Cross-epic validation rules

- Capture tests must distinguish microphone and system audio using controlled signal fixtures and actual devices. A unit test that feeds pre-recorded bytes into a fake source does not establish OS capture support.
- Provider tests must name the exact endpoint, provider/model, route options, file format, language, date, and response shape. Keep test transcripts synthetic or consented and avoid retaining unnecessary raw audio.
- All retries, queues, webhooks, and provider results must be treated as duplicate-capable and potentially out of order. Stable IDs and backend state transitions are the source of truth.
- Tenant isolation must be proven at the Savia API and object authorization boundary. The desktop UI hiding another tenant's data is not an authorization control.
- Cost evidence must include retransmission/retry cases and ambiguous outcomes, not just the nominal per-minute estimate. No budget promise is made by this roadmap.
- User-facing success must reflect durable backend state. A local capture that has not reached Savia is not a completed transcript.
- Roadmap edits should update status only when backed by reviewable artifacts, commands, test outputs, or provider/OS evidence. Do not mark an epic complete because its code compiles or a mock test passes.

## 2026-10-01 compressed sample increment

CMP-06 now includes local mono Ogg/Opus encoding at a target 32 kbps, bounded
resampling to 48 kHz, exact EOS trimming, encoded track metadata and immediate
raw PCM disposal. Limits remain 60 seconds and 512 KiB encoded per source.
Long-session chunking and recovery remain open.

CMP-08 now includes explicit personal-sample R2 persistence with authoritative
object metadata, consent, per-principal private keys, conditional/idempotent
uploads, owner-scoped listing/download/deletion and generated OpenAPI routes.
The main Savia library reads saved metadata from the backend. This does not complete
CMP-08.1 through CMP-08.5: meeting/job models, tenant rollout, queues, streaming
uploads, timestamped transcript segments, quotas and retention still need
their planned increments.

Prior YouTube capture media and screenshots were deleted at the user's request;
the historical [metrics report](macos-system-audio-smoke.md) remains. Synthetic
codec fixtures remain as automated regression tests and contain no meeting audio.

## 2026-10-01 compact capture and review increment

CMP-02 now separates the desktop capture/upload utility (380 × 540 px) from the
main-app review surface. Connection settings collapse; the native browser opener
accepts only validated origins and opens the fixed recording-library route.

CMP-08 adds private, schema-validated transcript/summary sidecars for saved
samples. Completed results are cached, a partial successful transcript survives
summary failure, deletion removes the sidecar, and requests sharing one bucket
binding serialize per owner/recording within an isolate. Cross-isolate provider
coordination, durable jobs and billing reconciliation remain open.

CMP-10 adds the authenticated main-app Recordings page: list, playback/download,
explicit remote-processing consent, structured draft notes and expandable source
transcript. It follows the existing Savia shell and supports ES/EN/PT. This is
partial CMP-10.1/CMP-10.3 delivery: timestamp-aligned playback, correction history,
diarization, background summary jobs and quality benchmarks remain pending.
