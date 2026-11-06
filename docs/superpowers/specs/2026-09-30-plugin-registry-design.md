# Shared private plugin registry

## Intent

Publish a plugin once, preserve it independently of environment databases and deployments, and install identical immutable versions into local, preview, production, and Docker. Tenant data, secrets, settings and activation remain local.

## Architecture

A dedicated Cloudflare Worker fronts a private R2 bucket. It validates ZIP packages with the existing parser, persists immutable versions and provides authenticated list, publish and download operations. It has its own deployment lifecycle and no dependency on tenant databases. No anonymous downloads or deletion endpoint.

Credentials are server-only bearer tokens stored as SHA-256 hashes in the registry secret `REGISTRY_CREDENTIALS` (array of `{tokenSha256, namespace, permissions: ["read", "publish"]}`). Each token authorizes one namespace; paths cannot select another namespace. Consumers have read-only credentials; publishers have read and publish permissions. Rotation is adding a new credential, replacing consumers, then removing the old credential.

`PLUGIN_REGISTRY_TENANTS` is a server-side JSON map keyed by exact canonical tenant ID (`tenant:123`), with `{url, token}`. There is no wildcard or default sharing. Operators explicitly map corresponding tenants across environments to tokens for the same namespace. URL must be HTTPS except explicit localhost HTTP for development; redirects are rejected. UI never receives tokens.

Registry HTTP contract:

- `GET /v1/plugins?cursor=...` -> `{data: [{id, version, label, sha256, sizeBytes, createdAt}], cursor: string|null}`. SHA-256 is of exact ZIP bytes; list returns up to 100 releases per page.
- `PUT /v1/plugins/:id/:version`, raw application/zip -> `{data: release, deduped: boolean}`; validate path matches manifest, reject changed semantic content under an existing version with 409, safe concurrent conditional create. An identical semantic retry preserves original ZIP digest.
- `GET /v1/plugins/:id/:version` -> original ZIP with `x-plugin-sha256`. Every request is authorized. No shared HTTP cache.

Studio adds authenticated tenant-admin list and import endpoints. Import fetches an explicit version, verifies requested digest and manifest identity, then uses the same existing upload validation, quotas, immutability and audit path. It imports into the local catalog; installation/activation remain deliberate existing actions. Existing plugins continue working during registry outages.

Publication is supported by a CLI accepting ZIP files and dedicated credentials, with reproducible release lockfiles recording exact versions and digests for promotion. Existing ZIP uploads continue to work. Shared registry UI is hidden when unconfigured, shows actionable unavailable state without breaking the local catalog, and imports explicit versions.

## Durability and rollout

The bucket is dedicated and must not be included in preview cleanup/reset. Existing artifacts are not deleted or automatically made cross-tenant. Existing source ZIPs can be published via CLI; database-only packages need an explicit export/migration path. Production operation requires provisioning the bucket, storing credentials, setting tenant mappings, backup and retention policy. Code installation alone does not claim live provisioning.

## Verification

Test unauthorized access, read-only publishing, namespace isolation, malformed/oversized ZIPs, immutable concurrent publication, digest and identity mismatch, tenant admin access, unavailable registry, and local runtime continuity. Run affected package typechecks/tests and deployment/CLI contract checks.
