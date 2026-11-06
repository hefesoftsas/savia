# MCP collection sources implementation plan

Spec: ../specs/2026-10-14-mcp-collection-sources-design.md

## Global constraints

- All connected MCP collections are read-only; only explicitly annotated read tools may execute.
- Source access, OAuth state and encrypted credentials are scoped to tenant and principal.
- No browser persistence, secret values in responses/logs, arbitrary redirects, remote private hosts, or implicit remote writes.
- Preserve existing JSON:API/database source behavior and existing UI components.

## Tasks

1. Adapter worker: shared mapping schema, bounded public HTTP client, discover/inspect/list operations and meaningful transport tests. Own new mcp-adapter.ts, mcp-adapter.test.ts, mcp-sources.ts.
2. Coordinator: migration, OAuth service with encrypted server persistence and one-time state, source manager routes and collection execution. Add source/OAuth integration tests before implementation.
3. UI worker: MCP creation and OAuth action, tool discovery and mapping in existing manager; i18n and UI tests. Disjoint admin files only.
4. Coordinator: generated API schemas, user guide, combined review, targeted tests and type checks. Investigate live SECOP configuration and record actual external access results.

Execution uses two bounded Luna workers with coordinator integration. Do not commit unrelated existing files. Tests and review findings are recorded in the final report; external authentication/deployment is not inferred from mocked evidence.
