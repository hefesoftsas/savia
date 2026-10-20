# Production readiness evidence — 2026-10-17

Owner: infrastructure. Review date: 2026-10-17.

This report records successive observations and follow-ups on the same date.
The user subsequently authorized activation; see **Activation authorized and
started** for the current rollout evidence. Earlier sections describe their
original observation time, including failed attempts and then-pending actions.
The activation created the protected state bucket, moved the adopted checkpoint
to the remote backend, configured the dedicated backup environment and deployed
a narrow storage guard around the existing production bundles. No production D1
migration or SQL restoration was applied. Independent recovery keys remain
outside the repository.

## Verified live identities

Production and preview are in Cloudflare account
`08a0d36f8b0357684f83e4bfeb6628b6`. Production's public custom domain is
`https://savia.app.hefesoft.com`; its gateway is `savia`. Both production and
preview health endpoints returned HTTP 200 with `database: ok`.

| Resource            | Existing identity                                                                     |
| ------------------- | ------------------------------------------------------------------------------------- |
| Auth D1             | `savia-auth-local-canonical-20260913-v2` — `adb5ccff-00ef-4450-8a82-8c6d9d5e2c1a`     |
| Domain D1           | `savia-agencies-local-canonical-20260913-v2` — `5ee54736-76e2-4415-945c-5daa325d1148` |
| Documents R2        | `savia-documents`                                                                     |
| Production Flows    | Not provisioned; both policy flags remain false                                       |
| Production state R2 | `savia-pulumi-state` does not exist                                                   |

The latest observed successful production deployment was
[run 37206627604](https://github.com/hefesoftsas/savia/actions/runs/37206627604)
from commit `c6d80f21ccb020f1ef470abe26f7cf5449501b85` on October 4.

## Adoption and remote provider plan

The two existing D1 databases and documents bucket were imported, with deletion
protection, into an isolated **local** Pulumi file backend. Imports registered
state and read existing resources; they did not provision cloud resources. This
uses a separate Pulumi home and leaves the existing preview backend unchanged.

`pulumi preview --refresh --stack production --save-plan ... --json` queried the
live provider successfully: **create: 1, same: 4**, with no updates, replacements,
or deletions. The sole proposed creation is the protected state bucket. It has
not been applied. This is a remote-resource preview using local adopted state;
it is not evidence that a shared production backend is operational.

Imports initially supplied no stack outputs. The local checkpoint was completed
with the program's evaluated outputs, after comparing every adopted D1 ID/name
and bucket name to the imported provider state. Backend outputs were explicitly
set to null because that resource does not exist. No nonexistent resource was
inserted into state. Production deployment preflight intentionally remains blocked
until the actual protected backend and CI credentials are available.

Private evidence and backup material are under the gitignored
`infra/secrets/production-readiness-20261017/` directory. Independent local state,
passphrase, and encryption key are under
`~/.config/savia/secrets/production-operations/` (directory mode 0700, secret files
0600). These local copies need durable team custody before promotion.

## Backup and recovery checks

The live capture exported auth D1 and dumped domain D1 (166 tables, 1,568 rows),
and confirmed that the documents bucket currently has zero objects. The final
cross-resource boundary check detected an auth bookmark change and **rejected**
the capture, exit 1. No successful manifest or restore-ready encrypted archive was
created. This failure proves the concurrent-write guard, not recoverability.
An isolated SQLite rehearsal restored auth with `integrity_check: ok` and no
foreign-key errors. All 66 current domain migrations applied, but replaying the
captured domain SQL then failed on `_savia_retired_20260930_agencies`. Production
contains nine `_savia_retired_20260930_*` tables with 85 rows; current migrations
do not recreate them. They must not be silently discarded. Preserve and review
their exact schema/data, then reconcile them or implement a reviewed archival
restore path before claiming domain recovery. At that stage the fallback rejected
retired tables to avoid emitting an apparently successful, unrestorable capture.
A second live capture using the new guard stopped immediately on those nine
retired tables, exit 1, and again emitted no success manifest. Its temporary
plaintext auth export was removed. A complete production restore rehearsal
remains pending a valid capture.
The production capture verifies D1 Time Travel bookmarks and complete R2
inventories before and after copying. A change invalidates capture; this is a
consistency detector, not an application write gate. A failed capture must not
produce a successful `manifest.json`.

An AES-256-GCM encryption/decryption round trip using the configured independent
key succeeded for the **rejected diagnostic capture**. Its encrypted archive is
`infra/secrets/production-readiness-20261017/rejected-capture-diagnostic.enc`
(SHA-256 `7167f7e0f60a0738d8c606fb1e71ec04aca19378a98e4fafa72be8819c118f90`).
It contains an explicit incomplete status, no successful manifest, and must not be
used as proof of a restorable production backup. Temporary plaintext data and
local diagnostic SQLite copies were removed after ciphertext verification.
A separate auth export check confirmed stable consecutive bookmarks before and
after native export; the export itself did not explain the earlier boundary
change. Running current production preflight exits 1 as expected because only a
local backend exists: a remote S3 backend is required.

Production currently has no Flows runtime to capture. The prepared Flows code
fixes an independent completeness defect: WorkflowAgent SQL-only exports omitted
ordinary KV state. Runtime manifest v3 now declares per-kind SQLite/KV coverage,
exports both segments, and restores pages atomically with replay checkpoints.
Versions 1 and 2 are rejected; producer and client must be promoted together.
A real Durable Object regression also verifies pagination beyond 128 KV keys.
None of that code has been published.

## Follow-up recovery validation

The production FTS5 fallback now emits `schema-dump`: the original table schema,
rows, explicit schema objects, AUTOINCREMENT sequences and external-content FTS
rebuild instructions. It retains all nine retired tables and `d1_migrations`.
Applying current canonical migrations first was rejected by an actual-data
rehearsal: current default role seeds conflict with historical production IDs.
Schema dumps therefore restore into a verified empty target without current
migrations. Existing target schema causes refusal before any D1 data load; loads
use authoritative current Pulumi UUIDs, including when resources were recreated.

An isolated rehearsal decrypted the original rejected diagnostic, reconstructed
its captured source schema/data, ran the new schema-bearing dumper, and restored
the generated SQL into a fresh local SQLite database. It verified:

- **9 retired tables and 85 rows preserved**, including duplicates and exact values.
- **All 166 captured tables / 1,568 rows** retained with exact row multisets.
- The restored source schema matches the captured schema.
- SQLite integrity is `ok`, foreign-key violations are zero, and the rebuilt
  external-content FTS index passes its own integrity check.

Wrangler's isolated local D1 importer also loaded all nine retired tables plus
the historical ledger: exact row multisets match (85 retired rows, 47 ledger
rows). Direct inspection of the emulator SQLite file confirms integrity `ok` and
zero foreign-key errors. The D1 API rejects its integrity PRAGMA with
`SQLITE_AUTH`, so that integrity check was performed against the local file.
The full 60 MB local CLI import was stopped during CPU-bound Wrangler parsing;
full-data verification used SQLite, while Wrangler transport was verified for
the archived tables and ledger. No remote SQL restore was attempted.

A read-only call to the new target preflight against live production correctly
refused its populated schema before any restore or migration. Production schema
capture now reads the table DDL catalog once and reuses it, avoiding hundreds of
redundant metadata requests during the consistency window.

This validates preservation of the captured source. The old diagnostic remains
incomplete across databases and is never relabeled as a valid production backup.
Private rehearsal evidence is retained as `archived-table-rehearsal.enc`
(SHA-256 `6fd77644e1abd857da5d9b7159c35b4048c4f54e9c5e286fd01761d4e980e633`),
with `archived-recovery-validation.private.json` as a small local summary.
Encryption/decryption was verified before plaintext SQL and emulator databases
were removed. Production data was not restored or modified.

The daily workflow now targets `production-backup` and invokes a tested runner
with at most three fresh capture attempts (60/120-second delays). Only typed
consistency drift is retryable. A complete version-2 manifest, both authoritative
D1 targets, documents R2, optional Flows stores, file/metadata inventories and
hashes must pass validation before encryption. The runner decrypts its ciphertext
and compares archive hashes before upload is allowed, and always removes plaintext.

An independent workflow checks every six hours for a nonexpired, nonempty
`production-backup-<run>-<attempt>` artifact from a successful `main` backup run,
no older than 36 hours. It fails closed on missing/stale artifacts or denied API
access and does not depend on a deployment environment's approval. GitHub step
summaries explain failures without exposing secrets; no external messages are sent.

Three follow-up read-only production captures were rejected because the auth
bookmark changed during copying. Two attempts exercised the automatic retry path;
the validation process was restarted with the optimized catalog implementation
for its final bounded attempt. No complete ciphertext or success manifest was
retained. This is operational evidence that automatic retries alone cannot
provide a guaranteed recovery point under current writes. The follow-up implementation below adds a writer barrier. It has not been deployed,
so these rejected captures remain the latest production evidence. The code does
not bypass the consistency guard or claim the diagnostic is a valid new backup.

The live freshness checker also failed closed while its workflow was unpublished;
it did not invent a last-success recovery point or send a notification elsewhere.

## Current activation prerequisites

1. **Remote state:** review and apply the existing create-only state-bucket plan
   in a separately authorized operation, migrate the protected local checkpoint,
   and verify a refreshed no-change plan. Provision backend credentials.
2. **Dedicated backup environment:** configure `production-backup` with restricted
   `main` access, no recurring reviewer gate, and dedicated credentials. Supply
   `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE`,
   `R2_STATE_ACCESS_KEY_ID`, `R2_STATE_SECRET_ACCESS_KEY`,
   `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and the independently preserved
   `SAVIA_BACKUP_KEY`, plus a dedicated `SAVIA_BACKUP_CONTROL_SECRET` shared only
   with the production API controller. The production encryption key exists; these values have not been copied
   into a new environment. Keep production deployment review protections intact.
3. **Publish and observe:** merge both workflows to the default branch, configure
   the team's GitHub workflow-failure notifications, and verify a first scheduled
   encrypted artifact and recovery drill. No workflow was dispatched here.
4. **Activate the writer barrier:** publish the reviewed standalone coordinator namespace migration
   and guarded Auth, request and connector workers in a separately authorized
   release. The prepared release workflows publish the coordinator before
   its dependents. Validate live capabilities, then execute a first encrypted
   capture and restore drill. The existing release backup prerequisite remains
   enforced; initial cutover requires a reviewed worker-only maintenance rollout
   before running the regular migration/apply release pipeline. Do not bypass
   recovery checks or publish unrelated changes to obtain a backup. Production
   Flows remains absent; unattended barrier acquisition fails if Flows is enabled
   because its independent queues, alarms and workflow executions need additional
   lifecycle coordination.
5. **Custody and retention:** move the independent encryption key and Pulumi
   passphrase into durable team custody, retain an independent recovery copy,
   and rehearse recovery periodically. GitHub retains encrypted artifacts for
   30 days; old Flows runtime snapshot pages still need cleanup if enabled.

D1 native exports block queries while the export runs and do not support virtual
tables such as FTS5. The schema-bearing fallback handles the observed domain and archived schemas
but still needs a stable write boundary. R2's S3 API does not provide bucket
versioning, so a successful capture must retain the copied objects themselves.
See [D1 export API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/),
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), and
[R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

## Initial local verification

- `pnpm run test:contracts`: 370 tests passed across both invocations.
- `pnpm --filter @savia/flows-api test`: all 80 Vitest files passed, 940 tests,
  plus 8 FFmpeg container tests.
- Maintenance/policy/recovery/preview-verification/encryption tests: 48 passed.
- `npm --prefix infra/pulumi run typecheck`: all three Pulumi programs passed.
- `pnpm --filter @savia/flows-api typecheck`: passed.
- Focused real Durable Object backup tests: 9 passed. Maintenance-route SQL/KV
  integration regression: 1 passed. D1 dump regressions: 11 passed.
- Changed-file Prettier formatting and `git diff --check`: passed.

The complete monorepo test/typecheck/lint lanes were not run. No infrastructure
apply, Worker publication, schema mutation, remote restore, successful daily
workflow execution, or successful complete production recovery rehearsal was
performed. The expected blocked preflight and rejected live captures are not
passing deployment-readiness checks.

## Follow-up verification

- `pnpm run test:contracts`: 393 tests passed across both invocations, including
  the new capture runner and freshness checks.
- `npm --prefix infra/pulumi test`: all 177 infrastructure tests passed.
- `npm --prefix infra/pulumi run typecheck`: all three programs passed.
- Full captured-source SQLite rehearsal: exact schema and all 166 row multisets,
  9 retired tables / 85 rows, FTS integrity, SQLite integrity and foreign keys pass.
- Wrangler isolated local D1 import: 9 archived tables / 85 rows and historical
  ledger / 47 rows preserved; local database integrity and foreign keys pass.
- Read-only live target preflight refuses populated production before any data load.
- Changed-file formatting and `git diff --check` pass.

No Cloudflare resource apply, Worker publication, live SQL restore/migration,
GitHub environment change, workflow dispatch, commit or push occurred during this
follow-up. The whole monorepo test/typecheck/lint lanes were not rerun; application
runtime source was unchanged. The full-file Wrangler local parser check and its
D1 integrity PRAGMA limitations are recorded above. No valid new joint production
backup or scheduled-run success was established.

## Follow-up: shared production write barrier prepared

`packages/backup-gate/` adds a persistent SQLite Durable Object coordinator. All
four D1/R2 writers use the same environment-specific namespace. Guarded operations
hold durable permits until their D1 execution or R2 mutation settles. Coverage
includes Auth GET/session initialization, scheduled work, `waitUntil` callbacks,
request/connector services, WhatsApp alarms, D1 batches/sessions and R2 multipart
mutations. The gateway's Office R2 binding only reads. The separately managed shared plugin
registry bucket is outside this stack's auth/domain/documents recovery scope.
Realtime tickets are
ephemeral DO state outside this D1/document recovery scope.

The authenticated API controller verifies the other three running writers'
version, required mode and namespace identity before closing the barrier. A
partially rolled out release cannot silently produce a supposedly gated capture.
The daily runner drains for at most 60 seconds, renews a three-minute lease every
30 seconds, checks ownership after capture, and releases its own lease on every
handled exit. It stops renewing after a 15-minute maintenance budget. Runner
termination reopens storage when the last lease expires. Failed acquisitions,
foreign owners, lost renewals and unsupported Flows prevent artifact publication.
Original bookmark and R2 inventory checks remain mandatory to detect direct
operator/API writes outside application bindings.

This is a storage checkpoint, not a multi-request application transaction. During
the capture window guarded database operations are temporarily unavailable;
callers must retry. The initial implementation guarded all D1 executions.
The October 20 latency correction exempts only conservative single `SELECT`
statements, as specified in the infrastructure runbook. Mutations and ambiguous
SQL remain guarded regardless of whether they use `all`, `first`, or `raw`.
The central permit coordinator adds latency and persistent writes to guarded
calls; measure traffic throughput and
backup duration in preview before production activation. Unknown in-flight permits
never expire automatically: an interrupted writer with an unacknowledged release
causes a failed drain and an actionable job failure, rather than risking data
loss. Ordinary scheduled backups need no manual pause or resume once activated.
Exceptional unresolved permits require investigation, not an automatic forced
clear. No remote state, deployment or SQL restoration was applied in this follow-up.

An independent 256-bit controller credential was also prepared in local private
custody at `/Users/casa/.config/savia/secrets/production-operations/backup-control-secret`
(mode 0600). It was not printed, uploaded to GitHub, or applied to a Worker. Supply
the same value to the production API upload and the dedicated backup environment
when activation is authorized. Production preflight now rejects its absence before
any apply, migration or secret upload.

Follow-up regression evidence:

- Full API, Auth, connector and request suites: 291 files, 2,560 tests passed.
- All four affected application TypeScript checks passed.
- Contract suite: 429 tests passed before the final stub-refresh regression; the
  final focused coordinator/controller/runner suite passed all 38 tests, including
  that additional transport regression.
- All three Pulumi TypeScript programs passed via
  `pnpm --dir infra/pulumi run typecheck`.
- Formatting passed for all 90 changed/new source and documentation files;
  `git diff --check` passed. Whole-monorepo test/typecheck/lint was not repeated.
- Native workerd D1/R2/SQLite Durable Object smoke: passed in the final serial run
  (8.90 seconds overall). It exercises native batch statement unwrapping, D1
  sessions, R2 writes/deletes, closed-gate refusals and post-release writes.
  Earlier 15-second runs under concurrent full-suite load timed out; the isolated
  lane now allows 60 seconds and CI executes it after the API suite.

## Activation authorized and started

The user subsequently authorized deployment and backend activation. The fresh
bootstrap plan contained exactly one creation (`savia-pulumi-state`) and no
application-resource mutation. Applying that saved plan created the bucket only.
The adopted checkpoint was exported and imported into the new R2 S3 backend;
resource URNs, IDs, protection, inputs and public outputs matched after normalizing
provider-internal D1 raw-state serialization. A refreshed remote preview then
reported only five unchanged resources.

The dedicated `production-backup` GitHub environment is restricted to `main`, has
no recurring reviewer requirement, and contains independent backup/control keys,
a long-lived read-only Cloudflare API credential and state-backend credentials.
The existing `production` reviewer protection was retained; backend/control
secrets were added there for future releases. The state S3 credential can write
objects only in `savia-pulumi-state`. The API token can read D1, R2 and Worker
metadata; the Cloudflare REST object API additionally requires account-level R2
Read even when the token also has a document-bucket Item Read policy. No database
write or Worker deployment permissions were granted to the daily backup token.

The currently deployed application is the October 4 release, while `main` contains
later application features. Cutover therefore stages an additional guarded entry
module around each exact captured production Worker bundle, preserving every
original module byte, runtime setting and inherited binding. Its version upload
compiles on Cloudflare before activation. The new standalone coordinator owns its
own migration lineage, avoiding unrelated API/WhatsApp DO migrations. No D1
migration or data restoration runs as part of this cutover. The operational
journal and rollback version IDs are kept in the ignored private evidence folder.

Production capture now uses full `schema-dump` queries for **both** Auth and domain.
The native D1 export endpoint requires D1 Write, so it is deliberately excluded
from unattended production backups. The daily token retains D1 Read only;
source-schema preservation, inner/outer Time Travel boundaries, full R2 inventory
verification and the renewable writer barrier remain mandatory. Preview native
exports and the refusal of legacy Auth table dumps are unchanged.

## First encrypted production recovery rehearsal

PR [#335](https://github.com/hefesoftsas/savia/pull/335) merged after required CI
passed. A full read-only production capture subsequently passed all inner and
outer D1 bookmark checks, R2 inventory checks, encrypted round-trip verification
and manifest validation. The local encrypted recovery artifact has SHA-256
`06b07b778916cc64081c437b3061b59a722bd4cf9ef7c49d3a68b64f284c5e2f`; plaintext capture and rehearsal files were removed.

An isolated transactional SQLite replay of that exact artifact verified:

- Auth: 20 regular tables and 65 rows.
- Domain: 166 regular tables and 1,568 rows.
- Nine retired tables with all 85 rows; 47 migration-ledger rows.
- Both integrity checks returned `ok`, with zero foreign-key errors.
- The domain external-content FTS5 integrity check passed; R2 contained no objects.

The live barrier was also exercised against public endpoints: Auth JWKS and API
health were unavailable while drained and returned HTTP 200 after release. The
account-wide live binding inventory confirmed that only the four guarded app
writers and the read-only Office gateway reference this recovery scope.

Earlier captures failed closed when Auth's outer Time Travel bookmark advanced
after its own dump finished. The successful diagnostic kept Auth active with
verified read-only queries while copying domain; it did not relax any consistency
check. A second capture used only ten-second read-only bookmark observations for
both databases and also passed on its first attempt. Its exact encrypted archive
passed the same complete local restore rehearsal. The capture implementation now
keeps observing every D1 target through the final boundary verification, stops
and awaits observations before manifest creation, and refuses to commit if any
observation drifts or fails. The provider's underlying bookmark movement remains
an inference; no consistency check was removed or relaxed. At this observation
stage, a successful local artifact did not yet establish a successful retained
GitHub backup run; that end-to-end workflow check is the next activation gate.
