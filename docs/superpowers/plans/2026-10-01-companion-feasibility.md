# Savia Companion Native Feasibility Implementation Plan

> For agentic workers: use `superpowers:subagent-driven-development` for independent implementation tasks or `superpowers:executing-plans` for sequential execution. See the implementation status for code delivered and qualification still pending.

**Goal:** demonstrate independently audible microphone and system capture on macOS and Windows before committing to the complete meeting product.

**Architecture:** optional Tauri desktop client with Rust capture adapters; backend owns persistent meeting data and provider credentials. Initial capture proof is local and uses permitted fixtures; backend integration follows later epics.

**Tech Stack:** candidate Tauri 2, React, TypeScript and Rust; CoreAudio taps on macOS 14.2+; WASAPI loopback on Windows 11. Pin actual versions after toolchain/reuse checks.

**Spec:** [architecture](../../companion/architecture.md), [epics](../../companion/epics.md), [validation](../../companion/validation.md).

## Execution record — 2026-10-01

The implemented increment includes the pinned native host, local source adapters,
short-sample UI and an opt-in backend STT/summary seam. The backend seam was
implemented and tested without paid calls while device qualification remained
pending. It does not introduce durable meetings, general tenant rollout or a VPS.
See [implementation status](../../companion/implementation-status.md) for exact
verification evidence and deferred epic scope. Unchecked gates below are not
release claims; code delivery alone does not satisfy native/provider qualification.

## Global constraints

- Code delivery and qualification are separate. See [implementation status](../../companion/implementation-status.md) for progress; hardware and provider gates remain pending.
- Use repo worktree isolation and preserve existing contributors' edits.
- Do not introduce OpenRouter keys, paid requests, a VPS, a bot or automatic recording in this increment.
- Select and audit immutable upstream revisions before importing any code; exclude commercial enterprise paths and preserve licenses/notices.
- Declare OS/architecture support only from real-device evidence; generated fixtures are insufficient.
- Keep capture files outside Git. Avoid browser persistence. Native temporary files have an explicit cleanup policy.
- API reference remains generated for the implemented backend endpoints.

## Review focus

Privilege boundaries; accurate state when permissions/devices fail; callbacks and thread safety; source separation; clock ordering; bounded file writes; correct resource teardown; license provenance. Require a human to listen to the produced source files.

## Task 1 — Close scope and reuse decisions (CMP-00/CMP-01)

- [ ] Confirm the product name and initial OS/build/device coverage in `docs/companion/README.md`.
- [ ] Record input/output selection, start/stop, gap and temporary-file lifecycle in `docs/companion/architecture.md`.
- [ ] If upstream code is selected, create `apps/companion/THIRD_PARTY_NOTICES.md` with repository, immutable commit, file paths, licenses and complete transitive dependencies. Do not mark review passed with only a root license badge.
- [ ] Record numeric quality/resource thresholds and permitted fixtures in `docs/companion/validation.md` before qualification runs.
- [ ] Gate: reviewed scope, auditable code reuse and reproducible fixture procedure.

## Task 2 — Introduce reproducible native host (CMP-02)

Planned files: `apps/companion/src-tauri/Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, `capabilities/default.json`, `src/main.rs`, `src/lib.rs`, `apps/companion/src/` and package/build configuration. These are implemented in the validation workspace; qualification still requires the listed checks.

- [ ] Pin native dependencies/toolchain, document platform prerequisites and isolate desktop commands from the root `pnpm dev` stack.
- [ ] Add minimal manual controls and typed allowlisted IPC; no arbitrary renderer filesystem or shell access.
- [ ] Add meaningful tests for invalid IPC parameters and lifecycle transitions before implementation.
- [ ] Run the eventual `cargo test --manifest-path apps/companion/src-tauri/Cargo.toml` and desktop frontend typecheck; document exact scripts added to `apps/companion/README.md`.
- [ ] Gate: native shell builds and opens on both target systems with no unsolicited capture.

## Task 3 — Define capture contract and teardown (CMP-02/CMP-05)

Planned files: `src-tauri/src/capture/mod.rs`, `session.rs`, `timeline.rs`; relative to `apps/companion`.

- [ ] Specify source identifier, device selection, monotonic frame offset, format, gap event, session status and stop/discard results.
- [ ] Write failing tests named `stop_releases_each_source`, `failed_source_does_not_report_recording` and `clock_adjustment_does_not_reorder_frames`.
- [ ] Implement only the platform-neutral lifecycle needed by these tests, then run targeted and full native tests.
- [ ] Gate: error states and ownership are explicit; stopping twice is safe; no sample collection after stop.

## Task 4 — macOS capture proof (CMP-03)

Planned files: `src-tauri/src/capture/macos.rs`, platform permission declarations and macOS capability tests.

- [ ] Implement CoreAudio output tap plus independent microphone capture under manual start.
- [ ] Request permissions at the correct action; surface denial/revocation and unsupported versions.
- [ ] Write bounded finalized test samples through the native host; keep sources separate.
- [ ] Run short native experiment from the validation protocol, then repeated start/stop and device loss tests; inspect copies with `pnpm --filter @savia/companion audio:inspect /absolute/path/to/sample.wav` and listen to originals.
- [ ] Gate: attach real-device evidence, signed-build permission behavior and recorded limitations. Mock tests do not pass this task.

## Task 5 — Windows capture proof (CMP-04)

Planned files: `src-tauri/src/capture/windows.rs` and Windows capability tests; disjoint from the macOS adapter after the shared contract is stable.

- [ ] Implement selected render endpoint WASAPI loopback and independent input stream.
- [ ] Handle device absence, privacy restrictions and endpoint invalidation; do not promise per-process capture.
- [ ] Run native experiment and device switching tests on Windows 11 x64; listen to each source and record driver/build details.
- [ ] Investigate Windows 10 separately; keep its status unverified until its actual build/device tests pass.
- [ ] Gate: actual Windows artifacts and resource teardown evidence; cross-compilation alone is insufficient.

## Task 6 — Compare feasibility and decide integration scope

- [ ] Record sanitized results and unresolved defects in the validation report; retain private originals outside Git.
- [ ] Update epic/story statuses individually rather than marking the entire product complete.
- [ ] Estimate CMP-05 through CMP-11 from measured work and outstanding risks.
- [ ] Confirm whether both adapters justify Tauri or whether an alternative runtime needs a bounded experiment.
- [ ] Schedule backend/STT implementation only after capture evidence; no VPS deployment is required for this gate.

## Required risk-to-test mapping

| Risk                                   | Test/evidence that resolves it                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| Permission denied but UI looks active  | Real deny/revoke cases and `failed_source_does_not_report_recording`.                 |
| Recording continues after stop         | `stop_releases_each_source` plus native file/handle inspection after repeated stop.   |
| System/mic are confused with speakers  | Distinct-source tone/speech experiment and manifest review.                           |
| Independent device clocks drift        | Marker offsets in sustained dual-source runs and monotonic timeline tests.            |
| Device switch silently loses audio     | Bluetooth/USB route change runs with explicit gap events and audible recovered files. |
| Privileged IPC accepts arbitrary paths | Malformed/path traversal negative tests against the capability boundary.              |
| Imported code carries commercial terms | Immutable file/dependency license ledger and notice review before import.             |

## Completion record

For each task record files, commands, OS/hardware evidence, outcomes and skipped checks. G1 can pass per platform; G2 (provider/backend) and G3-G5 remain separate gates. Do not claim native feasibility from the current WAV inspector tests.
