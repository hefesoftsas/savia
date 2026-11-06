# SECOP tenders plugin implementation

> Historical design: the SECOP integration was retired. See [retirement notes](../../secop-tenders-plugin.md).

1. Coordinator: extend the declarative plugin action schema/packer and host execution with a principal-bound read-only MCP executor. Write protocol, input, isolation and unavailable-host tests first; preserve existing action kinds.
2. UI worker: independently create `packages/plugin-secop-tenders` with source normalization, search, persistent deduplicated interests, versioned follow-up editing, localization, responsive UI, manifest/store requirements and tests.
3. Deployment explorer: resolve the documented branch-preview pipeline and authenticated loading path without displaying secrets. Coordinator owns cloud mutations and git integration.
4. Coordinator: integrate, run appropriate API/server/shared/plugin checks, pack and inspect the ZIP, review combined changes and prepare an isolated feature branch. Deploy preview through its supported workflow, complete OAuth in the selected preview tenant, upload/install/activate and verify actual search and persisted tracking. Report concrete external blockers if present, continuing independent work.
