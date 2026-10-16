# Faster Preview Iterations Implementation Plan

**Goal:** Publish compatible plugin frontend updates without a full platform release, scope CI to affected code, and accelerate complete API-based R2 backups.

**Approved scope:** The user approved the installation-latency diagnosis recommendations in this conversation. Preserve shared Preview isolation, exact tested commits, existing required check names, and recoverability. This is an improvement to the existing release pipeline, not a new deployment environment.

## Tasks

- [x] Add a standalone conservative Git change classifier and tests. Plugin frontend updates require an existing package, an increased version, unchanged manifest capabilities and unchanged store/package configuration. Unknown inputs require the platform lane.
- [x] Classify CI using trusted base-revision code, keep required check results, and make the existing Contract tests gate depend on successful plugin validation. Run Flows for affected or uncertain changes.
- [x] Resolve publication impact against the last successfully published ancestor, including any accumulated undeployed platform changes. Unknown history requires a complete release.
- [x] Add a private Preview-only plugin publisher that checks actual enabled installations, preserves a durable recovery checkpoint before mutations, publishes exact digests/versions, and rolls back partial failure without overwriting concurrent user changes. Never activate absent or disabled optional plugins or silently delete history to free quota.
- [x] Route the existing Preview workflow to either its unchanged full recovery path or the plugin publisher. Preserve repository/main/success/supersession guards and promotion evidence. No public helper Worker or additional credentials.
- [x] Download API-backed R2 objects with bounded concurrency, default4 and range1–8. Preserve metadata, compressed bytes, quiescence and restore invariants. Stop scheduling on failure, await active work and withhold successful manifests.
- [ ] Review combined changes, run release contracts and backup/restore tests, merge through protected CI, then measure an actual compatible plugin release in shared Preview.

## Review focus

- A failed or skipped new plugin-validation job must still fail an existing required gate.
- A prior failed platform deployment must prevent a subsequent plugin commit from skipping undeployed platform changes.
- Optional plugins absent from other workspaces must remain absent; a disabled installation must remain disabled.
- Publication failure, health failure and concurrent manual changes require explicit rollback results, never a false success.
- Failed parallel downloads must not produce an apparently complete recovery archive.

The full platform release retains the original migration and recovery sequence. Incremental backups, arbitrary partial Worker releases and broader permission/schema changes are outside this first optimization.
