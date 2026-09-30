# Shared private plugin registry

The registry stores published ZIP releases in a dedicated private R2 bucket, independently of local, preview, production, and Docker databases. It is an optional distribution service. Existing tenant uploads and installed plugin execution remain local and continue to work when the registry is unavailable.

## Storage and isolation

- `apps/plugin-registry` is a standalone Worker. Its `PLUGIN_REGISTRY` binding points to `savia-plugin-registry`, never to an environment document bucket.
- Each server credential selects exactly one namespace. Clients cannot choose another namespace in a request. Separate tokens may share a namespace across environments.
- `REGISTRY_CREDENTIALS` is a Worker secret containing an array of `{tokenSha256, namespace, permissions}`. Permissions are `read` and `publish`; use read-only tokens in Savia environments. Use cryptographically random tokens of at least 32 characters. Only hashes are stored in registry credential configuration.
- The complete original ZIP is stored with its digest and release metadata in one conditional R2 write. Publishing different semantic contents under an existing version fails. Repacking unchanged contents returns the original release and digest.
- There is no public bucket endpoint, anonymous download, overwrite, or delete API. Removing a local installation does not remove its published release.

Do not put credentials in plugin manifests, lockfiles, Git, frontend environment variables, or browser storage. Never embed tenant SMTP, OAuth, provider or database credentials in plugin source or `store.json`; publishing does not redact package contents. Per-tenant connection secrets and runtime settings remain in the existing environment database.

## Provision the independent registry

From a trusted operator machine with Cloudflare credentials, first create the dedicated bucket:

```sh
pnpm --filter @savia/plugin-registry exec wrangler r2 bucket create savia-plugin-registry
pnpm --filter @savia/plugin-registry exec wrangler deploy
pnpm --filter @savia/plugin-registry exec wrangler secret put REGISTRY_CREDENTIALS
```

The last command reads the JSON secret interactively. Generate a separate random bearer token for each publisher/consumer and compute each token's lowercase SHA-256. Example secret structure (replace placeholders; the token itself is not the hash):

```json
[
  {
    "tokenSha256": "<64-character-publisher-token-hash>",
    "namespace": "savia",
    "permissions": ["read", "publish"]
  },
  {
    "tokenSha256": "<64-character-preview-reader-token-hash>",
    "namespace": "savia",
    "permissions": ["read"]
  },
  {
    "tokenSha256": "<64-character-production-reader-token-hash>",
    "namespace": "savia",
    "permissions": ["read"]
  }
]
```

The Worker denies all access before valid credentials exist. Use its HTTPS origin or attach a dedicated domain. Keep bucket lifecycle rules from expiring release objects. Configure an appropriate R2 bucket retention lock and independent scheduled backups of **both objects and custom metadata**; API immutability alone does not prevent a Cloudflare account operator from deleting the bucket. Back up credential configuration securely and test restoration with a pinned release. Retention and backup policies require operator configuration; this implementation does not silently create a retention lock or backup schedule.

`.github/workflows/deploy-plugin-registry.yml` provides a manual independent deployment. It accepts only dispatches from `main`, checks out the selected commit explicitly, and rejects a commit superseded on `main` after tests and immediately before the credential-bearing deployment step. It uses the protected `production` GitHub environment with its existing `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, plus `PLUGIN_REGISTRY_CREDENTIALS`. Credentials are available only in the deployment step; installation and tests run without them. The independent Worker and bucket remain outside preview teardown. Provision the bucket before running it. Preview reset and teardown workflows do not manage this bucket. Credential changes take effect independently of Savia releases.

## Configure consumers

Set the API Worker secret `PLUGIN_REGISTRY_TENANTS` to a JSON object. Map the exact **local tenant key**, which can differ between environments, to the registry origin and a read-only token:

```json
{
  "tenant:42": {
    "url": "https://registry.example.com",
    "token": "<preview-read-token-at-least-32-characters>"
  }
}
```

No wildcard or automatic inheritance exists. A tenant absent from this map has no shared catalog. Corresponding production/Docker tenants can point to the same namespace using different tokens. The server never sends those tokens to the browser. HTTPS is required, with HTTP allowed only for localhost/loopback development. Redirects are refused to prevent forwarding credentials.

- **Workers:** `wrangler secret put PLUGIN_REGISTRY_TENANTS --config apps/api/wrangler.preview.jsonc` (use the production config for production). The existing secret upload helper also accepts this optional value.
- **Local development:** add `PLUGIN_REGISTRY_TENANTS='{"tenant:42":{...}}'` to `infra/secrets/plugin-registry.dev.env`, then restart `pnpm dev`.
- **Docker:** add the same environment variable to the file selected by `SAVIA_ENV_FILE`, then recreate the Savia service. Both SQLite and PostgreSQL use the same registry consumer. Tokens remain server-side.

A tenant administrator opens **My plugins → Shared catalog**, selects a displayed version, and chooses **Add to workspace**. The backend verifies the pinned ZIP digest and manifest identity, revalidates the package, checks local quotas, then adds it to that tenant's local catalog. After import, **Install version** activates that exact version; the ordinary local store install button retains its latest-version behavior. Installation remains a separate deliberate action. Importing does not overwrite tenant settings or credentials. Existing-version conflicts require a new version; import does not silently replace content.

## Publish once and promote identical bytes

Set `SAVIA_PLUGIN_REGISTRY_URL` and `SAVIA_PLUGIN_REGISTRY_TOKEN` in the publishing process environment. Use a publish-capable credential only in a trusted operator/CI job. Do not pass tokens on the command line.

```sh
pnpm store:pack store-ports/http-echo --output /tmp/http-echo.zip
# Use the actual id/version from that port's savia-extension.json:
pnpm registry publish custom.http-echo 1.0.0 /tmp/http-echo.zip plugins.lock.json
```

`publish` creates or updates a lockfile containing one release per plugin ID, its exact version, byte size and SHA-256. Commit the lockfile to the application release. A semantic retry uses the already-published ZIP and digest.

Use a read-only credential to download the same releases into a fresh directory in every environment:

```sh
pnpm registry pull plugins.lock.json /tmp/savia-release-plugins
```

All downloads are verified before any final ZIP is written; existing files are not overwritten. The ZIPs can be uploaded through the tenant UI or used by the existing release deployment runner. Do not combine source regeneration with locked ZIPs for the same ID: regeneration is not artifact promotion. Existing `deployment/plugins/sources.json` remains an explicit legacy release policy; adopting lockfile promotion is deliberate, not automatic.

A lockfile is an auditable release input, not a digital signature. Trust depends on protected publishing credentials, registry storage, HTTPS and code review of lockfile changes. Do not promote a mutable `latest` alias.

## Existing packages, recovery, and rotation

Existing packages are not automatically copied to the shared registry or exposed to other tenants. Publish retained original ZIPs or rebuild the corresponding source under its original version only if contents are identical. Database-only artifacts remain covered by the environment database backup until exported/rebuilt and published; this feature does not claim to migrate them automatically. Review package contents before widening access to a namespace.

To roll back, import a previously published explicit version, then request the extension installation API with `{ "version": "1.0.0", "allowDowngrade": true }`. An explicit downgrade is available only to an authorized administrator; the UI does not silently downgrade an installation. Review any data/schema compatibility before rolling back a plugin that changed collections. Removing a version from a local catalog does not delete the central copy.

To rotate, add the new credential hash to `REGISTRY_CREDENTIALS`, update consumers/publishers, verify access, and remove the previous hash. Revoked tokens stop new downloads; installed plugins keep running from local storage.

## Verification

```sh
pnpm --filter @savia/plugin-registry test
pnpm --filter @savia/studio-server test test/plugin-store.test.ts
pnpm --filter @savia/api test test/plugin-registry-config.test.ts
pnpm --filter @savia/admin test src/features/studio-engine/test/plugin-registry.test.tsx
node --test scripts/plugin-registry.test.mjs scripts/dev-api-runtime.test.mjs
```

Registry tests exercise real emulated R2 through workerd. They do not assert that a remote bucket, retention policy, backup schedule, or deployment has been provisioned.

## Provisioned shared service (2026-09-30)

The shared service is deployed at `https://savia-plugin-registry.jose-douglas-dev.workers.dev` with the dedicated `savia-plugin-registry` R2 bucket. A 30-day retention rule covers every object. The `savia` namespace currently contains the 25 first-party release plugins, including both customer portal versions (26 releases total). `deployment/plugins/registry.lock.json` pins the selected releases; it does not change the existing automatic deployment policy.

The initial publication reused 24 retained ZIPs after comparing their contents with the repository packages (the portal's earlier version differs only by its manifest version). The current portal and quotes releases were packaged from the repository. Tenant-authored packages were not shared. All six configured reader credentials (four preview tenants and two production tenants) were verified, read-only publication was rejected, and all 26 release ZIPs were downloaded with verified digests into a protected local recovery copy. Scheduled independent backups remain an operator follow-up.

The environment-specific tenant maps are stored in the API Worker secrets and GitHub environment secrets. They take effect in the UI when the consumer changes pass review and deploy through the existing preview/production gates. The central service is already active independently of that rollout.
