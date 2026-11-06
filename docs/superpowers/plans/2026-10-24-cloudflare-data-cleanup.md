# Cloudflare Data Cleanup Implementation Plan

**Goal:** Perform the user-authorized initial removal of accumulated action histories, obsolete plugin releases, and SECOP reports/chunks, then maintain bounded daily cleanup.

**Architecture:** A private Cloudflare scheduled Worker uses five existing D1 bindings directly. It performs only allowlisted deletions and keeps installed plugin versions plus the newest release. The spending guard preserves this Worker's daily cleanup schedule while continuing to disable its public entry points and native AI access. No extra Durable Object or runtime API credential is needed.

**Retention:** Initial cleanup removes all terminal action runs and all SECOP report/chunk rows. Daily cleanup removes terminal runs and reports/chunks older than 24 hours. Pending runs, installed plugin releases (including disabled installations), latest releases, original dossiers/documents, requirements, connections, other database tables and backups remain intact.

**Recovery:** Export the affected tables to private compressed local recovery files before the initial deletion. Keep only aggregate counts and hashes in public documentation. Never print credentials, signed download links or customer payloads.

## Tasks

- [x] Test and implement idempotent, bounded SQL cleanup with real SQLite preservation and cutoff tests.
- [x] Test the spending guard schedule exception without exempting public URLs or AI bindings.
- [x] Validate exports, execute initial cleanup through the same implementation, and compare counts and preserved data.
- [x] Deploy the scheduled Worker with no public URLs, verify the exact Wrangler config and arm the daily trigger only after a real execution succeeds.
- [x] Run focused and contract checks, review the diff, document live evidence and publish the changes.

## Verification focus

- Tenant isolation and concurrent installation must prevent deletion of installed releases.
- Semantic version ordering must not mistake 1.10.0 for an older 1.9.0 release.
- Retry and partial batches must converge without deleting protected records.
- UTC ISO timestamps and SECOP millisecond timestamps must enforce the 24-hour cutoff.
- The spending guard must preserve only the cleanup schedule, without restoring app access or inference.

## Completion evidence

Initial deletion totals: 8,687 terminal histories, 253 obsolete releases, 85 related source records and 20,984 reports/chunks. Protected installation contents, business-record counts and original dossier fingerprints matched the first snapshot across both resumable passes. The private recovery exports parsed successfully and matched their recorded hashes.

The backup-aware Worker version `6c3e6840-3f28-4ebb-9636-a4e55b39c71f` completed a natural cron invocation at 16:39:41 UTC with no exceptions and 20 ms CPU. The temporary verification report was removed. The final daily schedule was read back, public URLs remained disabled, and the spending guard retained its stop latch with no action errors. Focused tests passed 49/49; contracts passed 764/764.
