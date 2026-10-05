# Preview and production

## Delivery flow

`main` push → Savia CI → Deploy Savia preview → manual production promotion.

Preview URL: https://savia-preview.hefesoft.com
Production URL: https://savia.app.hefesoft.com

The preview workflow accepts only successful CI runs caused by a push to `main`
in this repository. It checks out the tested SHA and rejects superseded commits.
PR CI and fork CI cannot access preview credentials or trigger deployment.

The private app registers its service worker manually. Its generated worker
explicitly enables `skipWaiting` and `clientsClaim`: `registerType: autoUpdate`
does not supply those defaults when `injectRegister` is disabled. A deployed
replacement activates while existing tabs are open and triggers the app's
update notice. The user chooses **Actualizar y recargar** to load the new app;
activation itself does not reload an open form or discard its draft. Do not
clear site data to recover a stale shell, because it can contain offline edits.

## Isolated resources

| Component    | Production                  | Preview                    |
| ------------ | --------------------------- | -------------------------- |
| Gateway      | `savia`                     | `savia-preview`            |
| Auth         | `savia-auth`                | `savia-auth-preview`       |
| API          | `savia-agencies`            | `savia-agencies-preview`   |
| MCP          | `savia-mcp`                 | `savia-mcp-preview`        |
| Requests     | `savia-request`             | `savia-request-preview`    |
| Connectors   | `savia-connectors`          | `savia-connectors-preview` |
| Auth D1      | Existing production binding | `savia-auth-preview`       |
| Domain D1    | Existing production binding | `savia-agencies-preview`   |
| Documents R2 | `savia-documents`           | `savia-documents-preview`  |

Each GitHub environment supplies its own `SAVIA_AUTH_D1_ID` and
`SAVIA_DOMAIN_D1_ID`. Preview additionally supplies `SAVIA_PUBLIC_ORIGIN` and
`SAVIA_DOCUMENTS_BUCKET`. The deployment verifies the remote database names
before any mutation, so a production ID configured by mistake is rejected.

The Savia Request Worker shares the domain D1 database. Its global
`installed_bundles` ledger is created by
`packages/db/migrations/0075_savia_request_installed_bundles.sql`; the
insurance package installer needs this table to prepare quote flows.
Generated configuration stays ignored by Git. Secret uploads use
`upload-cloudflare-secrets.mjs`, which validates every Worker name and passes an
explicit environment config to `wrangler secret bulk`. Do not use the
wrangler-action `secrets` input: it ignores the deploy command's `--config` and
would select the application's default Worker.

The API uses `SHLINK_SERVER_URL=https://go.cloud.hefesoft.com` and the
`SHLINK_API_KEY` Worker secret to create public short links. The Savia preview
Worker has its own Shlink API key with the author-only role; production must use
a separately generated key. Keep both keys only in their matching API Worker
secret stores. If a key is absent, the Savia-hosted fallback short link remains
available.

Preview began with a one-time copy of production schema and data, verified
against the source export by table counts and complete row fingerprints. Further
deployments preserve preview data and apply pending migrations; they never
refresh or overwrite the databases from production. Production exports are
private operational files and must never become GitHub artifacts or Git files.

The encryption keys match the copied encrypted records. Preview credentials are
stored in its GitHub environment. Business integrations copied from production
can still refer to live external accounts: interactive operations use those
accounts. Scheduled synchronization is disabled in preview to avoid duplicate
background work. A workflow-only scheduler runs once per minute so explicitly active
workflows and incoming webhooks can execute; it also retains the newest 200
operational audit events per domain. It does not invoke external CRM operations or
scheduled collection record-history maintenance. Preview OAuth origins and service
bindings point to preview.

The Companion meeting-recording pilot is enabled in preview so its authenticated
recordings routes are available against the isolated preview R2 bucket. The
generated production Worker config omits `COMPANION_ENABLED`, so Companion stays
disabled in production until it is deliberately enabled there.

The public gateway uses an exact custom domain. Wildcard custom domains are not
supported by Cloudflare; tenant-specific hostnames need separately provisioned
routes/DNS/certificates before use.

## Automated health verification

The check verifies public DNS/TLS and health when the public request is accepted.
Cloudflare Bot Fight Mode can challenge GitHub-hosted runners. A challenge alone
never counts as healthy: CI additionally opens a short-lived authenticated
Wrangler remote session, whose only service binding is `savia-preview`. The probe
only reads the deployed gateway's fixed `/health` endpoint and requires both the
gateway and database to report `ok`. It exposes no application proxy, writes no
data, and publishes no persistent Worker or public route. The local listener is
loopback-only and the session stops after verification or failure.

This verifies application readiness independently of bot filtering; it does not
prove that every public automated client can pass the domain's bot protection.
Bot protection remains enabled for preview and production. Promotion evidence
is created only after this authenticated check succeeds.

## Recover an older preview interface

The shared `savia-preview` gateway is a release target for the successful
`main` CI workflow. Use [branch previews](preview-environments.md) for manual
feature testing. A direct Wrangler deployment from another checkout can replace
its assets independently of the API and database, bypassing CI's superseded
commit check. An update notice can then install that older interface even while
newer integration records remain intact.

If a released feature disappears after **Actualizar y recargar**:

1. Compare the gateway's active version with **Verify deployed gateway** in the
   latest successful **Deploy Savia preview** run. Use the run's tested commit
   and version ID; a health check alone does not identify its frontend release.

   ```sh
   pnpm --filter @savia/api exec wrangler deployments status --name savia-preview
   pnpm --filter @savia/api exec wrangler deployments list --name savia-preview
   ```

2. Inspect the visible interface and the script URL in its rendered document.
   Compare an existing tab with a new tab. Both can share a service worker, so
   matching old interfaces are evidence to investigate, not proof by themselves
   that the server reverted. Confirm the deployment history before changing the
   cache policy or treating this as lost application data.
3. If an unintended direct deployment replaced the verified release, coordinate
   with anyone deploying preview and restore the exact previously verified
   gateway version. Check its `API` service and `OFFICE_RUNTIME` bucket bindings
   first. Replace `<verified-version-id>` with the version recorded in the
   successful CI run; do not infer it from the most recent deployment alone.

   ```sh
   pnpm --filter @savia/api exec wrangler versions view <verified-version-id> --name savia-preview
   pnpm --filter @savia/api exec wrangler rollback <verified-version-id> --name savia-preview --message "Restore verified preview release"
   ```

   This restores the gateway code and assets without reverting bound D1/R2
   resources. It is operational recovery of an already verified release, not a
   replacement for CI validation of new source changes.

4. Use the app's **Actualizar y recargar** action, then perform a normal reload.
   Verify the feature and its saved backend record still appear. Do not clear
   site data: pending offline changes and credentials must remain intact.
5. Confirm the restored gateway version is active and record the recovery in
   private operational notes. Resume the regular `main` CI delivery flow for
   subsequent changes; do not publish private tenant inventories or credentials
   in the recovery PR or workflow artifacts.

## Promote to production

1. Verify that preview succeeded for the current `main` commit and test preview.
2. Open Actions → Deploy Savia production → Run workflow, selecting `main`.
3. The action checks a successful deployment job and its SHA-bound promotion
   evidence artifact for that commit, then reruns CI. Evidence is retained for
   30 days; an expired artifact requires rerunning the successful preview
   workflow before promotion.
4. Approve the pending `production` environment deployment.
5. Review the ordered Worker deployments and domain migrations.
6. Verify authentication separately from `/health`: an anonymous
   `/api/auth/get-session` request must return HTTP 200 (an empty session is
   expected), and `/api/auth/admin/authorize` must redirect to sign-in. The
   gateway health response checks the domain database; it does not establish
   that Better Auth can initialize its separate authentication schema.
   Complete a browser sign-in or reuse an existing session to verify the
   deployed UI before declaring the release ready.

There is no automatic production trigger, emergency CI bypass, or database reset
input. Running preview never changes production Worker bindings or databases.
The separate production variable import workflow remains disabled.

Initial resource provisioning must create all six preview Worker targets before
the first deployment because API and MCP have mutual service bindings. The
initial placeholders return 503 and have public workers.dev URLs disabled.
Existing production Workers must never be used as bootstrap targets.
