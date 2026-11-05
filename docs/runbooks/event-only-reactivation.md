# Event-only reactivation and deferred operations

Status: preparation in progress; this document does not confirm deployment.

Remote inventory on November 5 confirmed empty cron arrays on all Savia Workers,
disabled production backup/freshness workflows, no attached Worker custom domains,
and paused Savia preview queue delivery. The last preview release on October 30
failed during managed runtime apply. Resolve release readiness before restoring
traffic; repository definitions alone do not establish live health.

On November 5, 2026, the operator authorized reactivating Savia preview and
production without recurring pings or polling, and explicitly requested that
periodic backups, cost monitoring and scheduled jobs remain disabled as technical
debt. This supersedes the October 30 plan's no-deployment constraint. It does not
authorize reactivating SECOP or other unrelated services.

Use request-driven reads, authenticated change events and connection/focus
reconciliation. Reconnect attempts after actual connection failure are recovery
work; do not use a heartbeat or periodic state refresh to keep idle clients active.
Do not advertise durable delivery while the outbox repair schedule is disabled.
Cloudflare alarms or retries for real queued work are distinct from idle polling,
but existing paused workloads must be inventoried before resuming their queues.

## TD-EVENT-01 — Automatic operational protections

Periodic production backups, backup freshness checks, the cost guard schedule,
and API/Flows cron triggers stay disabled. Manual controls remain available.
There is no automatic backup freshness assurance or automatic cost-stop check
in this mode. Existing spending caps and provider restrictions remain unchanged.
Automatic retention also stops: published outbox events, execution history and
other scheduled-cleanup data can accumulate until maintenance is explicitly run
or redesigned. This operating mode has not been validated for 10,000 active users.

Before restoring automation, define recovery objectives, retention, budget limits,
an owner and a validated alert path. Then choose an explicit low-frequency schedule
or an event-driven trigger and verify failures and recovery. Do not silently restore
cron schedules through a later release.

## TD-EVENT-02 — Durable delivery without scheduled repair

Immediate outbox publication does not cover a crash between commit and publish.
With scheduled repair disabled, failed publications can remain pending. Keep
`REALTIME_OUTBOX_RECOVERY_ENABLED` unset/false. Provide a tested durable wakeup
and bounded retries before enabling that capability. Reopening or refreshing a
screen reads authoritative state; an idle stale connection may not update until
transport failure, focus, reconnect or manual refresh.

## TD-EVENT-03 — Workflow scheduling and progress

Minute-based workflow scheduling, scheduled notifications and cron maintenance
do not run in this mode. Implement durable next-occurrence alarms, configuration
generation checks, bootstrap and pause/resume fencing before restoring scheduled
flows. Add acknowledged replay for execution progress before claiming reliable
live completion without periodic fallback. Pending jobs may need manual refresh.

## Release gates

- Verify exact generated configs for both environments, with empty cron arrays
  and no prohibited AI bindings.
- Preserve isolated data, secrets, OpenRouter models and price caps.
- Publish through the managed release path with the mandatory pre-release backup;
  disabling recurring backups does not waive that one-time release safeguard.
- Verify preview before production, including authentication and event delivery.
- Check remote schedules and GitHub backup workflows after publication.
- Record deployed versions and observed health; do not infer activation from
  local tests or source edits.

## Isolated Auth diagnosis

The authenticated initialization session reports allowlisted failure categories
and upstream HTTP status without forwarding response bodies or credentials.
Distinguish bridge rejection, revision mismatch, transport failure and initialization
rejection before choosing a recovery action. A recovered older deployment cannot
establish which response the attempted release returned before rollback.

When initialization fails, do not repeat the full release merely to collect
evidence. The manual `Diagnose preview Auth offline` workflow accepts the failed
preview deployment run ID and its exact source SHA. It runs only on `main` in the
protected `preview` environment, validates the source workflow and repository,
and prepares the existing recovery archive for private offline inspection.

The source is decrypted with `SAVIA_BACKUP_KEY`; the archive is re-encrypted with
`SAVIA_FLOWS_BACKUP_KEY` for the operator's existing diagnostic custody. Only the
encrypted result is retained, for one day. No Cloudflare credentials are supplied,
no remote database is changed, and application secrets are not rotated. Decrypt,
inspect the manifest, and extract Auth SQL only in private local storage. Replay
the SQL with fake application credentials.
Manifest validation compares planned bucket names and values without depending
on JSON property order; reordered Pulumi output remains valid, while missing,
additional or mismatched buckets are rejected.
Keep Preview deployment temporarily disabled while diagnosing, then re-enable it
only when the release blocker has been corrected and checked.
