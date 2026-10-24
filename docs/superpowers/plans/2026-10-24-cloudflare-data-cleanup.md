# Cloudflare Data Cleanup Implementation Plan

**Goal:** Perform the user-authorized initial removal of accumulated action histories, obsolete plugin releases, and SECOP reports/chunks, then maintain bounded daily cleanup.

**Architecture:** A private Cloudflare scheduled Worker uses five existing D1 bindings directly. It performs only allowlisted deletions and keeps installed plugin versions plus the newest release. The spending guard preserves this Worker's daily cleanup schedule while continuing to disable its public entry points and native AI access. No extra Durable Object or runtime API credential is needed.

**Retention:** Initial cleanup removes all terminal action runs and all SECOP report/chunk rows. Daily cleanup removes terminal runs and reports/chunks older than 24 hours. Pending runs, installed plugin releases (including disabled installations), latest releases, original dossiers/documents, requirements, connections, other database tables and backups remain intact.

**Recovery:** Export the affected tables to private compressed local recovery files before the initial deletion. Keep only aggregate counts and hashes in public documentation. Never print credentials, signed download links or customer payloads.

## Tasks

- [x] Test and implement idempotent, bounded SQL cleanup with real SQLite preservation and cutoff tests.
- [x] Test the spending guard schedule exception without exempting public URLs or AI bindings.
- [x] Validate exports, execute initial cleanup through the same implementation, and compare counts and preserved data.
- [ ] Deploy the scheduled Worker with no public URLs, verify the exact Wrangler config and arm the daily trigger only after a real execution succeeds.
- [ ] Run focused and contract checks, review the diff, document live evidence and publish the changes.

## Verification focus

- Tenant isolation and concurrent installation must prevent deletion of installed releases.
- Semantic version ordering must not mistake 1.10.0 for an older 1.9.0 release.
- Retry and partial batches must converge without deleting protected records.
- UTC ISO timestamps and SECOP millisecond timestamps must enforce the 24-hour cutoff.
- The spending guard must preserve only the cleanup schedule, without restoring app access or inference.
