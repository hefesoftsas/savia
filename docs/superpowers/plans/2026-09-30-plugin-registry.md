# Shared Plugin Registry Implementation Plan

> **For agentic workers:** Use the repository orchestration rules with bounded ownership. Execute the approved design in this session.

**Goal:** Durable private plugin publication and reuse across environments.
**Architecture:** Independent R2 registry, authenticated tenant consumer, existing local plugin runtime.
**Tech Stack:** TypeScript, Workers R2, Hono, React, Node CLI, Vitest.
**Spec:** `docs/superpowers/specs/2026-09-30-plugin-registry-design.md`

## Global constraints

- No credentials in browser responses or logs.
- Exact tenant mapping; no wildcard access.
- Immutable versions; existing local data/settings retained.
- Docker and Workers use identical consumer logic.

## Review focus

- Concurrent publication cannot overwrite a version.
- Untrusted archive paths and inflated ZIPs stay bounded.
- A forged import must not bypass tenant administration.
- Redirects cannot forward registry credentials elsewhere.
- Registry outage must not break installed plugins.

## Tasks

- [x] Registry worker: `apps/plugin-registry/`, test auth, isolation, ZIP validation, immutable R2 persistence, pagination and digest downloads. Provide the exact HTTP contract from the spec. Add independent Wrangler configuration.
- [x] Studio consumer: `packages/studio-server/src/plugin-registry.ts`, registration and persistence reuse in plugin-store; test list/import authorization, hash mismatch, retry and offline installed plugin behavior. Add `pluginRegistry?: {url:string;token:string}` option to createStudioApp.
- [x] Runtime integration: parse `PLUGIN_REGISTRY_TENANTS`, pass selected config via API gateway, forward Docker environment. Test malformed config and exact tenant selection.
- [x] Publication CLI: publish ZIPs and download pinned releases with hash checks, reusable lockfile. Test denied publish and version/digest preservation.
- [x] UI: optional shared registry section using existing compact components; import version to local catalog, maintain local listing on errors. Test configured/unconfigured/import flows.
- [x] Documentation: operational setup, tokens, backup, promotion, environment independence, migration, and limitations.
- [x] Review combined implementation; run affected tests/typechecks and record outcomes.

## Authorization

The user approved implementation with “si hazlo”. Proceed without additional design or implementation permission requests.

## Verification outcomes

- Registry: 12 tests passed against emulated R2; Wrangler deployment dry run passed.
- Studio server: 302 tests passed, 7 skipped across 43 files.
- API configuration and administration: 14 tests passed.
- Admin registry and existing plugin store: 10 tests passed.
- Repository contracts: 90 tests plus 4 core-boundary tests passed.
- Typechecks passed for registry, Studio server, API, admin, and self-hosted packages.
- Formatting and whitespace checks passed for changed files.
- Local HTTP smoke published a real package, retried publication, pulled the locked ZIP with matching bytes, denied anonymous access, and retained the release after restarting the Worker.
- Browser checks covered desktop and mobile with the real registry component and explicitly simulated transport data. Import and version installation UI states passed; this was not a live remote tenant installation.
- Review findings were fixed with failing-then-passing regression tests: deployment credentials are restricted to the deploy step, and CLI release identifiers match the service contract.

## Operational work outside this implementation

The central Cloudflare bucket, remote credentials, tenant mappings, retention and backups have not been provisioned. Preview and production have not been deployed or migrated by this task. Docker configuration and typechecking are covered; a live Docker integration run was not performed.
