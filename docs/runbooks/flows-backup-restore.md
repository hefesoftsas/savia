# Flows backup and restore

The Pulumi backup tools capture the Flows D1 database and its three R2 buckets
alongside the platform's auth/domain D1 databases and documents bucket. A
version 2 manifest binds the files to the Pulumi stack, Cloudflare account,
environment-specific resource names, R2 metadata sidecars, and SHA-256 hashes.
The restore tool still accepts version 1 manifests for existing backups.

## Backup

Keep the bridge, JWT, and master encryption secrets in the normal external
secret store and preserve their values across recovery:

- `SAVIA_FLOWS_BRIDGE_SECRET`
- `JWT_SECRET`
- `SECRET_MASTER_KEY`
- `FORM_SIGNING_KEY`

They are not written to Pulumi outputs or backup manifests. Confirm that the
selected stack and Cloudflare account are correct. Pause Flows writes and
execution and enable maintenance mode. The maintenance CLI checks the paused
state, exports each Durable Object page sequentially, asks the server to
complete and store the snapshot, then writes its manifest with file permissions
`0600`.

Backups generate a fresh UUID when `--snapshot-id` is omitted, and verify that
the server echoes it. Pass an explicit UUID when the operation must use a known
identifier.

```sh
node scripts/flows-maintenance.mjs \
  --action backup \
  --snapshot-file /secure/flows-runtime-snapshot.json \
  --apply

node infra/pulumi/backup.mjs \
  --stack preview \
  --apply \
  --confirm-quiescent preview \
  --flows-snapshot /secure/flows-runtime-snapshot.json
```

The maintenance CLI requires `SAVIA_DEPLOY_ENVIRONMENT`, the matching exact
`SAVIA_PUBLIC_ORIGIN`, and `SAVIA_FLOWS_BRIDGE_SECRET`; it requires an HTTPS
origin with no credentials, query, or fragment. The Pulumi backup command also
needs its normal Cloudflare account and API token credentials. Use `production`
for the production stack and confirmation. The Pulumi backup checks that every
page in the completed snapshot exists in the Flows resources bucket and
matches its digest. It then captures auth/domain/Flows D1, documents R2, all
three Flows R2 buckets, complete R2 object metadata, and file hashes. Keep the
entire output directory together; the manifest refers to its sibling files.
Do not use `--skip-r2` for an enabled Flows backup. Without `--apply`, the
maintenance CLI only prints a dry-run plan and sends no request.
Before backup or restore, the CLI polls maintenance status every five seconds
until Flows is paused, maintenance mode is enabled, and active runs reach zero.
The default drain timeout is 1,200 seconds; set
`--drain-timeout-seconds <1-1200>` to choose a shorter bound. On timeout, Flows
remains paused and no snapshot or restore starts. Review the running work before
deliberately resuming service; rerun the operation after it is quiescent. The
`--action status` command reports the active run count without waiting.
The hashes detect changed backup files relative to the manifest; keep the
manifest in a protected or immutable location if you also need evidence against
someone replacing both payloads and their hashes.

The stack must remain paused until the exports finish. A coherent backup needs
the D1 export, R2 inventory, and runtime page inventory to describe the same
quiescent state. Preview table-dump fallback requires explicit quiescence confirmation.
Production schema-bearing dumps additionally require unchanged live Time Travel bookmarks
and the complete backup boundary described in
[pulumi-infrastructure.md](pulumi-infrastructure.md#backups-data-not-just-infra).
Concurrent writes invalidate the capture even if an operator supplied
`--confirm-quiescent production`; that flag alone cannot establish consistency.
Production release and daily archives use `SAVIA_BACKUP_KEY`; the legacy preview
encryption command also accepts `SAVIA_FLOWS_BACKUP_KEY`. Preserve both stable
keys independently of the archives. Daily CI does not publish code to pause a
running Flows service: arrange a maintenance window first. Production deploys
perform the explicit pause/snapshot sequence before their backup.

Runtime snapshot version 3 declares the storage coverage of all five Durable
Object kinds: DatabaseDO and MailboxDO SQLite, WorkflowAgent SQLite **and typed
KV**, AgentRunner SQLite, and EmailAgentRunner typed KV. WorkflowAgent pages
export SQL first, then bounded KV pages (128 keys maximum); restore enforces
segment order and commits each page with its replay checkpoint atomically.
Schema inventory uses exact internal-name prefixes so similarly named user tables
are retained. Replaying an applied page checks its checkpoint before attempting
any storage changes. The maintenance-route integration test verifies SQL and KV
segments, index/trigger restoration, AUTOINCREMENT sequence, and page replay.
This includes execution buffers, form state, and submission/deduplication keys
that SQL-only snapshots omitted. The logical-name registry preserves agent targets
after a workflow definition is deleted. Runtime versions 1 and 2 are rejected
because they cannot establish complete coverage. The producer and maintenance
client must be promoted together before taking new Flows snapshots. This is
separate from the outer D1/R2 archive manifest, which stays version 2 and retains
its documented version-1 compatibility. The preview inventory is capped at 1,000
entries and every encoded page at 512 KiB; exceeding either cap fails backup
before migrations.

Each generated Worker manifest carries a policy generation. Re-render before
each deployment: a newer generation may deliberately resume execution, while
an older Worker cannot clear a newer pause. Pausing wins when generations match.

## Restore

Restore from the same stack and account recorded in the manifest:

```sh
node infra/pulumi/restore.mjs \
  --manifest /path/to/backup/manifest.json \
  --apply \
  --confirm-restore preview
```

The tool checks stack/account/resource names, file hashes, D1 SQL, every R2
object, and complete HTTP/custom metadata before it performs restore commands.
It recreates missing infrastructure, loads D1, and restores R2 while Flows
execution remains paused. Version 2 Flows restores include the snapshot
manifest and its verified runtime pages in the resources bucket. After the
D1/R2 restore, import the Durable Object pages from the remote completed
snapshot manifest:

```sh
node scripts/flows-maintenance.mjs \
  --action restore \
  --snapshot-file /secure/flows-runtime-snapshot.json \
  --apply
```

The CLI calls `inspect` and uses that server-side manifest as the page
inventory, then restores each page sequentially and confirms Flows remains
paused. Verify the recovered state before enabling execution. The CLI never
enables execution.

Redeploy the matching paused Worker artifact after importing the pages so Agent
SDK instances reload their restored SQL state. Restores require empty targets;
only the pinned SDK's exact schema-version bootstrap row is accepted in a fresh
Agent. SQL and KV checkpoints commit atomically with their page, so a lost reply
or interrupted import can be retried. SQLite BLOBs, foreign-key relationships
and deleted AUTOINCREMENT high-water IDs are preserved.

The signed maintenance endpoint must be reachable before the guarded restore
tool performs mutations. If the Worker or its bound databases were destroyed,
first bootstrap isolated empty resources through IaC and deploy the matching
paused maintenance Worker; the restore tool fails closed on unavailable status.

Cloudflare Workflow running instances, pending Queue messages, and KV namespace
values are not captured by this backup format. Runtime Durable Object state is
covered only when the complete maintenance snapshot includes its pages and the
separate restore procedure successfully imports them. Do not report a restore
as complete before that procedure and its checks succeed.

## Failed preview releases

For an existing Flows installation, the release pipeline records the active
Worker versions before entering maintenance. Capture validates the bindings of
every version serving traffic in the active deployment and uses the highest
active policy generation. It does not read the latest uploaded script settings:
those can still describe the temporary maintenance version after rollback and
must not block a subsequent release. A failure or cancellation after
pausing invokes recovery through an `always()` cleanup step. Recovery attempts
both affected Workers independently and reports any failures.

Before restoring the previous Flows configuration, recovery writes a newer
persisted pause generation. Restored Workers cannot clear that pause with older
configuration flags. This recovers the previous HTTP service configuration
without resuming workflow side effects. A later successful release with a newer
generation can apply the intended execution setting.

Worker rollback does not reverse D1, R2, or Durable Object data changes. Use the
paused restore procedure above when persisted data also needs recovery. The
pipeline refuses Durable Object lifecycle changes before pausing an existing
installation, since those changes can make previous Worker versions unavailable
for rollback. Cloudflare rollback safety failures are reported; recovery does
not force a deployment past those checks. See
[Cloudflare rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Destroy behavior

The guarded Pulumi destroy script empties the documents bucket and, when Flows
is enabled, the resources, datasets, and inboxes buckets before running
`pulumi destroy`. Destroy deletes D1 data and the optional Flows infrastructure;
take and verify a backup first if that data must be recoverable.

## Encrypted pipeline archives

The public repository retains only `flows-release-backup.enc` from preview
releases, for seven days. The backup key is separate from Flows encryption keys
and must remain available in a secure external store. Decrypt locally before
inspecting the manifest or performing recovery:

```sh
node scripts/encrypt-flows-backup.mjs --action decrypt \
  --input /secure/flows-release-backup.enc \
  --output /secure/flows-release-backup.tar.gz
tar -xzf /secure/flows-release-backup.tar.gz -C /secure/recovery
```

Supply `SAVIA_FLOWS_BACKUP_KEY` through the operator environment. A wrong key or
modified archive fails authentication and removes the partial output. Do not
extract an unauthenticated archive. Durable Object restore checkpoints make
repeating an interrupted import idempotent for the same snapshot and page.
A different page checksum is rejected. New targets must be empty. Virtual
tables and single SQL rows larger than 512 KiB are rejected during snapshot
export; resolve them before reporting a complete backup.

Recovery captures the Durable Object migration tag from the Worker service
metadata (`default_environment.script.migration_tag`), as Wrangler does.
The script settings endpoint supplies bindings and policy settings but does
not supply this lifecycle tag. Missing or mismatched service tags stop release
before any pause or mutation.

Preview maintenance uses a short-lived authenticated Wrangler remote session
with a private binding to `savia-agencies-preview`, so public-domain bot
challenges do not prevent backup requests from CI. It requires the existing
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in addition to the bridge
secret. The helper forwards only the fixed preview maintenance endpoint,
retains its short-lived signed maintenance JWT, and creates no published
Worker or public route. The session and temporary files are removed after
success or failure. Dry runs remain offline; production is not reachable
through this preview helper.

The API-token R2 fallback downloads stored bytes through raw HTTPS streaming,
without automatically decompressing `Content-Encoding: br` or `gzip`. It
requests the object's stored encoding, or `identity` for unencoded objects,
to prevent Cloudflare from applying a different compression during transfer. It
accepts valid HTTP coding tokens and coding lists, including their original case.
It checks every size and removes partial files on failure. Downloads and Wrangler
restores URL-encode each object-key segment while keeping the original key in
the manifest and filesystem.
This preserves literal percent escapes, spaces, Unicode, and URL delimiters
(e.g. a key containing `tenant%3A12` is sent as `tenant%253A12`). The S3
transport receives the original key because its SDK handles URL encoding.

Preview selects the raw API fallback with `SAVIA_BACKUP_R2_FORCE_API=true`;
the former `SAVIA_BACKUP_R2_FORCE_WRANGLER` selector remains a compatibility
alias for bypassing S3 credentials. No additional bucket credentials or
service activation is required.

Each raw download has a five-minute inactivity timeout that resets as bytes
arrive. The preview deployment job retains its 40-minute overall deadline;
slow but progressing objects are not aborted by a per-object wall-clock timer.

Workflow-agent restores accept an otherwise empty target containing only
PartyServer's nonempty `__ps_name` bootstrap identity. That platform key is
excluded from KV exports and rejected in restore pages; the target keeps its own
identity. Any other pre-existing KV data still causes refusal before replay.
