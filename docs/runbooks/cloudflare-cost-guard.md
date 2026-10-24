# Cloudflare spending circuit breaker

Owner: Savia platform team. Reviewed: 2026-10-24.

## Live policy

`savia-cost-guard` runs on Cloudflare every five minutes. It reads the account's
Billable Usage API and adds a USD 5 reserve for the known Workers Paid subscription.
At **USD 15 total** (USD 10 metered usage plus that reserve), it latches a pause.
This leaves USD 5 of nominal headroom before the requested USD 20 monthly ceiling.
It also pauses if billing is unavailable, malformed, or more than 48 hours stale.

The account's actual billing cycle starts on the 10th. The guard selects the most
recent billing period returned by Cloudflare and sums period costs, not cumulative
cost columns. It does not treat a calendar-month boundary as a reset. A stopped
guard **never resumes workloads automatically**, including at a new billing cycle.

AI Gateway `default` has two shared, enabled sliding-window spend limits:
**USD 1/day** and **USD 5/month**. These apply to requests passing through that
gateway. SECOP OpenRouter analysis uses the authenticated HTTP Gateway route,
without a native AI binding; it retains provider price ceilings of USD 0.15/M input tokens and
USD 0.75/M output tokens. A gateway 429 is terminal, without provider fallback or
automatic model retries. Prompt/response logging is disabled for these calls.
The dedicated `savia-openrouter-gateway` token was created with only AI Gateway Run
and saved as the SECOP `CF_AIG_TOKEN` secret on 2026-10-24. It expires on
2027-01-22. Its account-wide Gateway scope does not grant Workers AI or AI Search
inference. SECOP remains paused and both public URLs remain disabled. Missing or
expired credentials fail closed; never bypass the authenticated Gateway or its spend limits.

## Shutdown coverage

[policy.json](../../scripts/cloudflare-cost-guard/policy.json) enables
`accountWide` and `denyCloudflareAi`. Every check rediscovers account Workers,
Queues, Workflows, AI Search namespaces/instances, custom domains and zone Worker
Routes. New resources are included at the next check.

At the threshold, the controller:

- Applies Savia API/Flows maintenance and SECOP model pause flags.
- Pauses all discovered queues and queued/running workflow instances.
- Removes discovered cron schedules except the guard, backup coordinators and explicitly allowlisted data cleanup schedule.
- Disables workers.dev and preview URLs for all non-protected Workers.
- Detaches their custom domains and unbinds zone Worker Routes (`script: null`).
- Pauses discovered AI Search indexing.

Independently of the threshold, it removes native Workers AI bindings from
account Workers and pauses configured or discovered AI Search instances. This also
applies to backup scripts; backup execution is protected,
not inference. Global agent instructions and the `openrouter-only-ai` skill prohibit
Cloudflare inference, including embeddings, OCR and AI Search inference. The trusted
PreToolUse hook checks selected shell writes, patch additions and Wrangler configs.

The controller and backup coordinators retain their existing execution and triggers. Databases,
files, secrets, documents and reports are preserved. Original route/domain/settings
snapshots are saved before changes; domain detachment does not delete application
data. Custom domains can be restored with `PUT /accounts/{account_id}/workers/domains`
and the saved attach fields. Worker Routes can be restored with their saved
`pattern` and `script`. Do not restore native AI bindings.

## Permissions and credentials

The dedicated account token `savia-cost-guard` has Billing Read, Workers Scripts
Write, Queues Write and AI Search Write, plus Zone Read and Workers Routes Write
for all zones belonging to this account. It is stored as Worker secret
`CF_CONTROL_TOKEN`; `GUARD_ADMIN_TOKEN` protects operator requests. The token is
account-scoped because the control APIs do not offer a script-only policy for all
required operations. It cannot change billing subscriptions or read stored secret
values. Never deploy a short-lived Wrangler OAuth token as its runtime credential.

Local credentials and deployment recovery files are restricted to
`infra/secrets/cloudflare-cost-guard/` (gitignored, files mode 0600). The singleton
`CostGuard` SQLite Durable Object serializes checks and stores the stop latch and
immutable first recovery snapshots. No browser storage is used.

## Verify and operate

```sh
pnpm run test:cost-guard
node scripts/cloudflare-cost-guard/deploy.mjs prepare
node scripts/cloudflare-cost-guard/deploy.mjs check
```

`check` performs a real account check and returns sanitized status. Confirm
`tripped`, `reason`, `usageUsd`, `totalUsd`, `checkedAt` and an empty `actionErrors`.
The initial live check observed USD 53.126 in usage and USD 58.126 including the
fixed reserve, so it activated the shutdown immediately.

Activation was verified on 2026-10-24: after the manual check at 13:39:21 UTC,
the scheduled trigger updated `checkedAt` to `2026-10-24T13:40:24.042Z` with
`tripped=true` and `actionErrors=[]`. Independent API reads confirmed the
maintenance flags, paused queues and AI Search, and retained guard schedule.

In Cloudflare, open Workers & Pages > `savia-cost-guard` > Settings > Triggers:
the schedule is `*/5 * * * *`. In Compute > Queues, all six currently discovered
queues must be paused. In AI > AI Gateway > `default` > Settings, inspect Spend Limits.

The authenticated recovery endpoint returns only saved `recovery:` records in
pages of 100; the operator tool below exports them without printing settings.
Use the original snapshots to plan an explicit, reviewed resume. Preserve queues
that were already paused before the guard and existing disabled schedules. Do not
clear the latch just because the billing cycle changed. A release that overwrites
maintenance flags will be paused again at the next check while the latch is set.

```sh
node scripts/cloudflare-cost-guard/export-recovery.mjs
```

## Limits of the protection

Cloudflare's account billing data currently updates **daily**, despite five-minute
polling. AI Gateway cost accounting is eventually consistent, so concurrent calls
can overshoot its budgets. Existing storage, fixed subscriptions, requests reaching
maintenance endpoints, Durable Object alarms, service-binding calls and products
without a supported pause API can still incur charges. The inventory governs
Workers-related execution triggers; it does not cancel subscriptions or suspend
the account. Removing AI bindings does not revoke every existing API/OAuth token,
so external direct REST inference is not blocked by a Cloudflare account-wide deny
policy. The local hook is a practical guard, not a sandbox for arbitrary code. An expired/revoked token or Cloudflare control-plane outage can prevent
pause actions; a durable latch and `actionErrors` record that failure and checks
retry. This is a preventive circuit breaker, **not an absolute USD 20 invoice cap**.

OpenRouter BYOK inference remains billed by OpenRouter, not Cloudflare; the gateway
limit separately caps this routed AI traffic. Updating fixed subscriptions requires
revisiting the USD 5 reserve. Workflow pauses are processed in bounded pages; a
large active backlog can take multiple scheduled checks to quiesce completely.

Sources: [Cloudflare Billable Usage API](https://blog.cloudflare.com/billable-usage-api/),
[AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/).

## Credential permission audit

On 2026-10-24, the 11 pre-existing account API tokens were reviewed. None granted Workers AI
inference permissions; no personal User API tokens existed. The local Wrangler
OAuth authorization did include `ai:write` and `ai-search:run`. It was logged out
through Wrangler (revoking the stored refresh token) and authorized again with
those two scopes removed and the other 26 stored scopes preserved. `wrangler
whoami` and Cloudflare's Connected Applications permission view confirmed the
reduced grant. Its missing-inference-scope warning is expected; do not restore
those scopes through a default `wrangler login`.

AI Search Write is retained for administrative pause/index controls, without
AI Search Run. The cost guard uses its independent account token. The Global API
Key cannot have granular permissions removed and was neither viewed nor rotated;
account owners can still grant access again. These controls reduce credential
exposure but do not create an account-wide Workers AI deny policy.

## RAG and vector retirement

At the user's request on 2026-10-24, the following Cloudflare resources were
permanently deleted, with successful API responses and empty inventory verification:

- Vectorize v2 `savia-pages-search-preview` (10 vectors).
- Vectorize v2 `secop-dossier-evidence` (66 vectors).
- The retired private AI Search instance in `default` (41 vectors and 5 indexed files,
  with the instance's service-managed index).

Vectorize v1 also has no indexes. The `PAGES_VECTORIZE` and `DOSSIER_VECTORS`
Worker bindings were removed, the preview Pulumi `pagesSearchIndex` configuration
was removed, and the guard no longer has an explicit target for the deleted AI
Search instance. Dynamic discovery remains enabled for future resources. Do not
restore retired bindings from older recovery snapshots as part of a general resume.

All 11 D1 databases and the original application R2 buckets were retained. Schema
inspection found no standalone RAG D1 database. In the three Savia agencies
D1 databases, `assistant_virtual_employee_chunks`, `tenant_page_search_index` and
`tenant_page_search_index_leases` each had zero rows, and all Pages search settings
were already disabled. No operational tables, full-text record search, original
application documents, SECOP reports or backup files were deleted. The Pulumi
state reconciliation uses the manual `retire-vector-state` operation in
`pulumi.yml` generates a private candidate and permits an official stack import
only after exact allowlisted validation. It removes the one retired resource and
its stack/provider/runtime references, preserving secret values and all other
resources. Pulumi can re-encrypt unchanged secrets with fresh nonces on import;
verification decrypts both private snapshots in memory and compares their full
values and metadata. Ciphertext changes alone are never silently ignored. The first CI run (40106633346) passed infrastructure tests but GitHub
rejected the retirement job because the `preview` environment only permits
`main`. That initial attempt imported no state and changed no protection rule. After
integration into the permitted branch, run candidate validation first, then the
explicit apply checkbox. This retirement does not rewrite existing backups.

After retirement, controller version `861bf7a9-086c-4f5c-855c-5d93d58a6df8`
completed a real check at 2026-10-24 14:58:57 UTC with `actionErrors=[]`.
The five-minute cron was verified active again at 14:59:24 UTC. A scheduled check
at 15:15:19 UTC remained tripped with `actionErrors=[]`; its estimated cycle total
was USD 58.126 including the USD 5 fixed reserve. A subsequent account audit found
37 Workers, zero native AI bindings and no non-protected Worker public URLs.
The Gateway token was verified active and present as a SECOP secret, with the
model pause flag still set. No paid inference call was used for verification.

Controller version `277e09b2-f0a0-4aa7-ba50-b80e0d72b35e` adds AI Search
pausing below the threshold when `denyCloudflareAi` is enabled. A real check
at 15:17:51 UTC completed with no action errors, and the five-minute schedule
was read back successfully at 15:18:08 UTC. The 37 controller/provider tests pass.

The new controller also ran through its natural cron at 15:20:19 UTC with no action
errors. Final contract validation passed 752 tests; the CI infrastructure unit and
minimum-runtime jobs passed. Repository-wide lint/typecheck were not run.

The `savia-data-cleanup` cron is allowlisted through `maintenanceSchedules`; only
its scheduled cleanup remains executable. Its public URLs and native AI bindings
remain subject to shutdown. See [daily D1 cleanup](cloudflare-data-cleanup.md).

## Integrating changes while the account is paused

Disable the automatic `deploy-preview.yml` workflow and cancel any queued/running
preview deployment before merging a maintenance change into main. Leave it
disabled until the user deliberately resumes deployments. CI and the manual
Pulumi state-retirement workflow can remain enabled. Do not run `pulumi up`,
ordinary infrastructure apply, or application publication to reconcile this state.

From the merged main revision, dispatch `pulumi.yml` with `stack=preview`,
`operation=retire-vector-state` and `apply_retired_vector_state=false`. Check that
only the retired index and its allowlisted references are removed. Then dispatch
the same operation with `apply_retired_vector_state=true`. A successful import
must pass the post-import export comparison. Independently verify the persisted
checkpoint and the live account pause, including empty application routes, paused
queues, disabled non-protected URLs and absent native AI bindings. The guard and
backup/cleanup schedules remain executable.

### Verify an import that completed before its comparison failed

Do not repeat the retirement import when the live checkpoint already lacks the
index. Pulumi keeps the previous checkpoint at
`.pulumi/stacks/savia-cloudflare/preview.json.bak`. With automatic preview
deployment still disabled, dispatch `pulumi.yml` on main with `stack=preview`
and `operation=verify-retired-vector-state`. This read-only job downloads only
that official backup and the current preview checkpoint using the existing R2
credentials. It transforms the backup with the same exact retirement allowlist,
authenticates and decrypts passphrase-protected secrets in memory, and requires
complete equality with the current checkpoint. A wrong passphrase, unsupported
secret encoding, missing retired index in the backup, or any other changed
value fails closed. It neither imports state nor invokes a provider. Snapshots
and plaintext are never logged or uploaded; temporary files are private and
removed on exit.

The Preview R2 credential `savia-preview-pulumi-state` is limited to Object Read
& Write on `savia-pulumi-state-preview` and expires on 2026-11-23. Renew it with
the same scope before future state maintenance; never restore application or
AI inference permissions to repair backend access.

## Manual emergency stop panel

Open `https://savia-cost-guard.jose-douglas-dev.workers.dev/control` and sign in
with Cloudflare. The Access application **Savia account emergency controls**
protects `/control` and its subpaths. It accepts only the Cloudflare identity
provider, requires membership of this Cloudflare account and the administrator
email `jose.douglas.dev@gmail.com`, and uses a 30-minute session. The Worker also
requires the platform-verified `ctx.access` identity and `ACCESS_ADMIN_EMAILS`
allowlist; forged identity headers or a missing Access context are denied.
No administrator token is entered in or sent to the browser. **Log out** clears
the displayed state and redirects to Cloudflare Access logout. Cloudflare revokes
the user's Access sessions across protected applications, not just this panel.

Browser APIs use `/control/status` and `/control/stop`. Machine-only `/status`,
`/check`, `/stop` and `/recovery` retain the existing bearer credential so the
scheduled guard, deployment verification and private audits continue working.
The root URL redirects to `/control`. The Access application is configured in
Cloudflare; its non-secret desired configuration and resource IDs are recorded
in `scripts/cloudflare-cost-guard/access-application.json`. The Worker, panel,
allowlist and tests are versioned in the same repository.

Choose **Pause all environments**, then **Confirm pause**. The independent
controller records a persistent `manual_stop` latch before any external request,
without fetching billing. It then reapplies the same account-wide discovery and
pause policy used by the automatic cost guard. Later five-minute checks continue
enforcing the manual latch, including newly discovered targets. The operation is
safe to repeat and retains the original recovery snapshots. There is no resume
control. Existing application deployments remain disabled.

The panel reports each target action and incomplete discovery/action failures.
A saved latch is distinct from completed pause actions: **STOPPING**, **PAUSE
INCOMPLETE**, and **PAUSED** are shown separately. If a request times out, refresh
status before assuming it failed; the latch may already have been saved. The
same protected guard, backup coordinator and daily cleanup exceptions remain
active. In-flight requests can finish; pausing does not delete data or retroactively
cap billed usage.

For scripted operation, send an authenticated `POST /stop` with
`Content-Type: application/json` and body
`{"confirm":"PAUSE_ALL_ENVIRONMENTS"}`. Browser requests must come from the
controller's own origin. Status and panel responses use `Cache-Control: no-store`;
the panel also blocks framing and third-party script/network sources. No new
Cloudflare credential, binding, database, or inference permission is required.
