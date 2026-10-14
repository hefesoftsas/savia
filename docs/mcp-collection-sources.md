# MCP collection sources

Savia consumes external Streamable HTTP MCP servers through **Sources and collections**. This is independent of [Savia's own MCP endpoint](remote-mcp.md), which exposes Savia to external clients. MCP collection records stay on the remote service; refresh queries that service again.

## Connect a source

1. Open **Sources and collections → Sources**, create a source, and select **MCP**.
2. Enter the full HTTPS MCP endpoint, including its MCP path. Choose OAuth, bearer token, or no authentication.
3. For OAuth, leave client details empty when the server supports dynamic registration. Otherwise enter a registered client ID and optional client secret. Specify only the scopes needed. Register the exact callback shown by the connection flow with servers using pre-registered clients.
4. Save, then choose **Authorize with OAuth**. Complete authorization on the remote server's page. Close the authorization window and return to Savia. Refreshing the source or returning focus updates its status.
5. Choose **Test connection**, then select the MCP source when binding a collection. Discover tools, choose a read tool, configure its arguments and result mapping, and analyze the fields before binding.

Tokens, refresh tokens, client secrets and PKCE verifiers are encrypted in backend storage using the integrations key. They are not returned by source listing. OAuth state is tenant/owner/source scoped, expires after ten minutes and is consumed once. Source management and record access enforce the creating principal and tenant. A revoked or expired remote grant may require authorization again.

Discovery normally admits tools with `annotations.readOnlyHint: true`. Some existing servers omit annotations. An administrator who has reviewed their behavior may explicitly list those tools under **Additional read-only tool names** when creating the source. A tool explicitly annotated `readOnlyHint: false` cannot be enabled by this list. These declarations are trust decisions about the remote implementation; Savia cannot prove what a remote server does internally.

## Map records

- **Arguments**: a JSON object containing fixed tool inputs, including any required search parameters.
- **Items pointer**: a JSON Pointer into `structuredContent`, or into a single JSON text block when no structured result exists. For `{ "data": [...] }`, use `/data`. Use the empty pointer when the result itself is an array.
- **Identifier field**: the remote field holding a stable, unique string or number. Savia exposes its normalized value as `id`; include that field in the selected collection fields. Duplicate or missing identifiers reject a response.
- **Pagination arguments**: optionally name the tool's numeric limit and offset inputs. Savia supplies them for each requested page. Without these inputs, pages are slices of the bounded result returned by the configured tool; this does not discover additional remote results.

Only supported Studio field names appear during analysis. Unsupported remote names can still supply the identifier, for example Socrata's `:id`, which becomes Savia's `id`. Analysis returns field definitions, not sample record values. The selected fields determine which values record responses expose.

This version supports listing and refreshing records. It does not provide record-detail lookup, create, update, delete, schema writes, relationships, free-text UI search, UI filters, or UI sorting. Fixed search arguments belong to the binding. Only capabilities actually implemented are advertised. Generic operation mappings cannot enable MCP writes.

## SECOP Live

The **SECOP Live** preset supplies:

- Endpoint: `https://secop-live-worker.jose-douglas-dev.workers.dev/mcp`.
- OAuth scopes: `mcp:read offline_access`.
- Reviewed unannotated read tools: `buscar_licitaciones`, `detalle_licitacion`, `buscar_documentos`.

The deployed Worker source was inspected through the authenticated Cloudflare API on 2026-10-14. These tools query Socrata and do not mutate records. Its protected-resource and authorization-server discovery endpoints were also verified live. A live authorization-code + S256 PKCE flow, token exchange, MCP tool discovery, and one `buscar_licitaciones` read were subsequently verified with a dedicated verification client. This does not establish deployment or authorization of the Savia source-manager connection.

Start with `buscar_licitaciones`, arguments `{}`, items pointer `/data`, identifier `:id`, limit argument `limit`, and offset argument `offset`. The same procurement process can appear in several rows, so `id_del_proceso` is not assumed unique. `buscar_documentos` requires a `q` argument. `detalle_licitacion` returns rows under `/filas` and requires `id_del_proceso`; it is a fixed query, not the collection's record-detail operation.

SECOP's authorization page asks for an access key and checks it against the Worker's `API_KEYS` secret binding. On 2026-10-14, this binding was replaced with a new random key at the user's request. The local copy is in the gitignored `infra/secrets/secop-live.env` file with owner-only permissions. Replacing this binding invalidates previous API keys; existing OAuth grants are independent of that key check. Cloudflare's settings API lists the binding name but cannot recover an existing secret's value. Enter the existing key directly on SECOP's authorization page. Do not put it in a collection's arguments, source URL, repository files, or chat. Savia receives the resulting OAuth grant rather than the access key.

## Deployment and checks

Apply migration `0048_mcp_collection_sources.sql` before deploying API and Admin. It preserves existing sources while extending the source kind and adds expiring OAuth flows. Existing installations must retain their integrations encryption key. Do not edit the generated API reference; the tenant's OpenAPI/Scalar surface derives the new endpoints and payloads from runtime schemas.

Run the MCP adapter/source API tests, existing database-source regressions, the collection source panel tests, and API/Admin/shared TypeScript checks. Mocked protocol tests do not prove that SECOP's real consent page has been completed. Network calls require public HTTPS DNS targets, reject redirects, bound responses to 1 MB, and use a 15-second operation budget.
