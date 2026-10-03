# Companion phase 2 implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded delegated units and superpowers:executing-plans for root integration.

**Goal:** Capture up to one hour on mobile and desktop, recover interrupted desktop drafts, and persist background transcription/summary progress with grounded Q&A.

**Architecture:** Native desktop capture emits bounded independently decodable Ogg fragments with source-relative timeline offsets. R2 stores owner/workspace-bound session manifests, immutable chunks and durable leased job state. The existing scheduled runtime processes bounded work; app state is read from the backend after reconnect. Mobile foreground one-hour capture remains integrated; existing imports stay compatible.

**Tech stack:** Tauri/Rust/Swift, Flutter, Hono/OpenAPI, Cloudflare R2, existing scheduled Worker runtime and self-hosted scheduler.

**Spec:** [Confirmed scope](../../companion/long-recording-next-phase.md).

## Constraints

- One session spans at most 3,600 seconds; nominal desktop segments are 30 seconds with bounded 60-second codec validation.
- At most 120 chunks per source, microphone/system separate, maximum 240 total; preserve timing gaps and never merge independent Ogg containers as raw bytes.
- Existing 512 KiB Ogg chunk limit and 8 MiB raw segment bound stay enforced. No hour-long raw PCM vector.
- Upload and provider processing require explicit consent; owner, tenant and recording scope checks apply to every route.
- Cross-isolate leases use conditional R2 writes. A crash after provider submission requires explicit reconciliation before another potentially billable attempt.
- Native recoverable audio is bounded capture spool data, not an offline application database. Browser/local app state is not authoritative.
- No automatic business-record writes or external messages from summaries or answers.

## Tasks and ownership

- [x] Native capture worker: apps/companion/src-tauri source capture/lifecycle/spool modules, Swift helper, native commands and native tests. Continuous bounded segment capture, atomic recoverable manifest, one-hour stop, explicit discard and startup recovery. Expose bounded chunk read commands for sequential upload.
- [x] Backend worker: new apps/api/src/companion/sessions.ts and session-jobs.ts with focused tests. Private manifests/chunks, immutable retry identity, finalization validation, durable leases, partial transcripts, summaries and reconciliation/cancellation.
- [x] Root: session OpenAPI routes, scope allowlists, scheduled runtime integration and configuration validation. Regenerate API reference and add route/scheduling regression tests.
- [ ] Root: desktop session upload/recovery UI, web recording session library/player/job progress/Q&A; mobile long-audio integration where compatible. Keep permissions and consent visible.
- [ ] Combined verification: synthetic one-hour bounded-memory and restart tests, backend job replay/lease/tenant tests, frontend rendering and protocol tests, Flutter checks, Windows/macOS and Android builds.
- [ ] Update PR #150 around final scope, merge after required checks, deploy preview, publish replacement installers and verify public catalog/download hashes. Report physical-device/provider qualification separately when unavailable.
