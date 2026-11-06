# Infrastructure readiness implementation plan

**Goal:** Update recovery, production readiness, temporary-preview parity, and
operational documentation without applying infrastructure or publishing code.

**Architecture:** Keep Pulumi ownership of stateful resources and Wrangler
ownership of Worker publication. Existing adopted IDs remain authoritative.
Production backups verify unchanged D1 Time Travel bookmarks and complete R2
inventories around capture; concurrent changes invalidate the capture. FTS5 data
can use the table dump only with bookmark verification. Production Flows remains
opt-in and uses the same pause, snapshot, deployment, and recovery guarantees as
preview. The checked-in production account and legacy D1 names were verified remotely;
existing resources are adopted in isolated local state until the protected remote
backend can be provisioned and the checkpoint migrated.

**Tech stack:** Node.js 22, Pulumi TypeScript, Wrangler, GitHub Actions, SQLite.

**Scope source:** User-approved findings and implementation request in this chat.

## Tasks

- [x] Add failing tests for production consistency boundaries, FTS5 round-trip,
      missing permissions/bookmarks, changed D1/R2 data, and unsuccessful captures.
- [x] Implement read-only recovery boundaries, guarded table dumps, restore
      validation, private backup output, encrypted retention, and daily backup CI.
- [x] Add production preflight for adopted state, configured account/backend,
      protected resources, stable keys, and optional Flows rollout. Back up before
      migrations or IaC apply; fail closed on incomplete preparation.
- [x] Align branch-specific connector, Durable Object, rate-limit, and gateway
      bindings; retain explicit opt-in for schedules and isolated names.
- [x] Update recovery, production, and preview guides to match actual flags and
      CI behavior. Distinguish prepared configuration from verified live adoption.
- [x] Review the combined diff; run infrastructure typecheck, helper tests,
      affected deployment contracts, formatting and workflow syntax checks.

## Production follow-up checks

- [x] Renew existing Cloudflare OAuth access without broadening its scope.
- [x] Verify production identities and import existing resources into protected,
      isolated local state without cloud resource changes.
- [x] Run a refreshed remote provider preview and retain its private plan.
- [x] Configure the stable production backup key and verify encryption/decryption.
- [x] Attempt live capture, test actual SQL recovery locally, and document the
      concurrent-write and retired-schema blockers without a success manifest.
- [x] Reject unsupported retired-table dumps and fix SQLite/KV completeness gaps.
- [ ] Provision and migrate the production remote state backend (requires apply;
      explicitly outside this turn's authorization).
- [ ] Configure unattended backup environment/credentials and merge the workflow.
- [ ] Reconcile retired schema/data, establish a consistency window, then obtain a
      valid encrypted capture and rehearse complete recovery.

## Review focus

- No infrastructure apply, Worker publication, migration, or production restore.
- Authorized credential preparation includes OAuth renewal and the production
  backup-key GitHub secret; provider imports only register isolated local state.
- No production IDs invented or secret values emitted or committed.
- No successful manifest after failed consistency checks or stale-output reuse.
- Flows backup covers Durable Objects, D1, and all three buckets while paused.
- Failed deployment recovery preserves the pause latch and does not resume work.
- Branch previews must never bind shared preview or production data/services.
- Scheduled backups serialize with production deployments and retain only
  encrypted artifacts. A busy database must fail loudly, never claim a backup.

## Validation evidence

- Final contracts: 370 passing. Flows API: 940 Vitest tests across 80 files plus
  8 FFmpeg tests passing. Additional maintenance/recovery/policy tests: 48 passing.
- Focused regression and remote evidence are recorded in the dated readiness report.
- All three Pulumi programs and the Flows API typecheck pass.
- A refreshed preview queried the remote provider from protected local adopted
  state: create 1 (state-backend), same 4, no updates/replacements/deletes.
- Live capture attempted; auth changed during the copy, so no successful manifest
  was published. A controlled consistency window and restore rehearsal remain.
- Production backend bucket and CI backend credentials remain unavailable;
  deployment preflight must continue to fail closed.
- See `docs/runbooks/production-readiness-2026-10-17.md` for complete live evidence
  and the unattended-backup prerequisites. No infrastructure was applied.
