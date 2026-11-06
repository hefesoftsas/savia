# Cloudflare daily data cleanup

The user authorized an initial cleanup on 2026-10-24 for accumulated extension action history, obsolete plugin releases, and SECOP reports and text chunks. The SECOP portion was historical and has ended: the scheduled cleanup now targets Savia agency databases only. SECOP databases and their remaining data are outside this Worker and are retained.

## Runtime

`savia-data-cleanup` is a Cloudflare Worker scheduled at **03:15 UTC daily** (22:15 America/Bogota). It has no workers.dev URL, preview URL, HTTP maintenance endpoint, AI binding, runtime API token or model call. It creates no database or Durable Object. It uses three direct D1 bindings for Savia agency databases, configured in [wrangler.json](../../scripts/cloudflare-data-cleanup/wrangler.json).

The account spending guard explicitly preserves this cleanup schedule through `maintenanceSchedules`. The cleanup Worker remains subject to public URL shutdown, domain/route removal and native AI denial. Other application services remain paused.

Cleanup mutations participate in the existing production/preview backup barriers through two cross-script bindings to the existing BackupCoordinator namespaces. Missing coordinators or a closed backup gate fail before a write; the cleanup does not weaken backup consistency or create another coordinator.

## Retention rules

- Delete terminal `extension_action_runs` (`succeeded`, `failed`, `expired`) older than 24 hours. Pending executions remain intact.
- Remove obsolete `plugin_store_artifacts` by semantic version, separately for each tenant and plugin. Keep every installed version, including disabled installations, and all releases tied for newest semantic version precedence. Invalid version groups are retained and reported as an incomplete cleanup.
- Artifact deletion cascades to its associated `plugin_store_sources`. Installation rows and active release contents remain intact.
- SECOP databases, dossier records, source files, companies, requirements, jobs, and connections are outside this cleanup and remain untouched.

The initial Savia cleanup uses the same implementation with the age filter disabled for terminal action histories. The installed/latest plugin protections apply in both modes. The retired SECOP cleanup is not part of the scheduled Worker or its bindings.

Each deletion statement handles at most 100 candidates. The daily Worker allows 50 batches per target and reports remaining work or schema errors as a failed scheduled execution. Repeated runs are idempotent. Aggregate logs include counts only; customer payloads and tenant identities are omitted. Persistent Worker logs are disabled.

## Recovery and verification

Before the initial deletion, affected tables from the five then-targeted databases were exported to private compressed local recovery files under the gitignored secrets directory. SHA-256 hashes and SQL parsing were verified for every export. Recovery data is kept outside Cloudflare and is not committed or uploaded as a CI artifact.

The initial command compared installation contents and business record counts before/after cleanup, plus aggregate fingerprints of non-target dossier data. It did not use application endpoints or bypass the account pause to invoke model inference.

Do not recreate a deleted report/chunk by calling Cloudflare AI. Any future regeneration must use OpenRouter under the existing price caps and requires restoring the relevant application service deliberately.

## Initial operation evidence

The initial operation deleted **8,687 terminal action histories, 253 obsolete plugin artifacts, 85 associated source records, and 20,984 SECOP report/chunk records** across the five databases. At that time both SECOP databases had zero report/chunk records; that count is historical and this Worker no longer inspects or cleans those databases. Installed-plugin fingerprints, business-record counts, and fingerprints of all non-target dossier data matched their pre-cleanup values. The 35 pending preview action rows remained intact.

The preview database allocation dropped from 610,381,824 to 131,977,216 bytes at the first post-cleanup measurement. SECOP reported its previous allocation despite zero target rows; physical allocation and dashboards update separately from logical deletion. All 11 databases remained present.

The Worker deployment is version `6c3e6840-3f28-4ebb-9636-a4e55b39c71f`. The first natural cron execution at 16:38:41 UTC removed one deliberately expired synthetic report from the validation database, with no exceptions. The backup-aware version subsequently ran at 16:39:41 UTC with `outcome=ok`, 20 ms CPU, no remaining rows and no exceptions. The synthetic record was independently verified absent. The final `15 3 * * *` schedule was read back after replacing the temporary every-minute verification trigger; both public URL flags remained false.

Validation passed: 49 focused cleanup/controller/provider tests and 764 contract tests. No full monorepo lint/typecheck was run. The existing spending controller remained tripped with no action errors after the rollout.
