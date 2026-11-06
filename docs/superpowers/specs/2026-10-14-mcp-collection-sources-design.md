# Read-only MCP collection sources

The requested outcome is to connect external MCP servers, including the SECOP Worker supplied by the user, from the existing Sources and collections manager. Existing collection screens consume live records without copying remote data. The user explicitly requested implementation of the proposed read-only adapter and OAuth connection.

## Architecture

Add an `mcp` source kind and a server-side Streamable HTTP adapter using the existing MCP SDK. Source discovery lists tools with an explicit read-only annotation, plus annotation-absent tools explicitly reviewed and allowlisted by an administrator. An explicit non-read-only annotation is always rejected. An administrator maps a tool's static arguments, structured result JSON pointer, identifier field, and optional limit/offset arguments into a collection. Without remote pagination, pages slice the currently returned bounded result rather than implying remote completeness. Collection capabilities are fixed to list-only until a dedicated lookup contract exists. No generic MCP mutation endpoint is provided.

OAuth uses authorization-code S256 PKCE through the SDK, with optional pre-registered client configuration or dynamic registration. Credentials, tokens, refresh tokens, PKCE verifiers and short-lived states live encrypted in the backend. Callback state is scoped to tenant, owner and source, expires after ten minutes, and is consumed once. Redirect URIs are fixed to the authenticated Savia source callback. Remote metadata and transport destinations must pass public HTTPS/DNS validation; credentials must not follow redirects.

## Integration and verification

Keep existing tenant/owner source checks, collection metadata and designer behavior. Extend generated OpenAPI from runtime schemas. Add failure-first tests for connection discovery, OAuth state isolation/replay, encrypted credentials, mapping, and rejected writes. Regress JSON:API and database sources. Add UI tests for source creation, authorization and mapping. The SECOP live check must report actual connectivity separately from mocked tests. Cloudflare configuration may be inspected under the user's authorization, without displaying credentials or changing SECOP.
