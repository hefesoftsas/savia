# Remote MCP with OAuth

Expose Savia to Claude and ChatGPT through the canonical API origin's `/mcp`
endpoint using Streamable HTTP and Better Auth authorization-code + S256 PKCE.
Publish path-specific protected-resource metadata and forward issuer discovery.
The dedicated MCP resource is the API resource URL with `/mcp` appended.
Dynamic clients must obtain user consent and cannot bypass collection ACLs.

Keep the MCP Worker private. Exchange validated MCP-audience tokens through the
private Auth binding for API-audience JWTs lasting no longer than the input token
or 120 seconds. Preserve the subject, identity claims, and granted API scopes.
Never forward the external bearer token or arbitrary caller headers to MCP/API.
Auth signs the internal token with its existing JWKS keys; no new signing secret.

Reuse dynamic collection discovery and CRUD tools. Add employee discovery and
invocation, with safe public descriptions, active tenant membership checks,
active employee checks, bounded inputs and response streaming consumption.
Employee writes remain pending actions; confirmation is a separately annotated
write tool and remains principal-bound. Internal assistant tool allowlists must
not include employee invocation, avoiding recursive calls.

Test real signed tokens for audience/expiry/signature rejection, DCR and PKCE,
request forwarding, scope preservation, tenant boundaries, streaming results,
and unchanged private MCP usage. Document external client setup and deployment.
