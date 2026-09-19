# Remote MCP for Claude and ChatGPT

Savia exposes a Streamable HTTP MCP endpoint at `<SAVIA_API_RESOURCE>/mcp`.
For the production origin configured in this repository, the connection URL is
`https://savia.app.hefesoft.com/mcp` after deploying this change.

## Connect

1. Deploy Auth, MCP, API and the Admin gateway using the normal deployment
   workflow. It supplies the existing private MCP/API service bindings and
   `SAVIA_MCP_SHARED_SECRET`; no additional signing secret is required.
2. In the client's custom MCP connection settings, enter the endpoint URL and
   choose OAuth. The client registers itself through dynamic client registration
   (DCR); do not paste Savia's internal shared secret into a client.
3. Sign in to Savia, complete MFA when required, and review the consent screen.
   `savia.api.read` permits discovery and reading; `savia.api.write` also permits
   authorized mutations and pending-action confirmations. Request `offline_access`
   for refresh tokens. Availability of custom connectors and administrator approval
   depends on the client account/workspace.
4. Ask the client to discover collections or employees before using an identifier.
   For example: “List the collections I can access” or “Ask the sales employee to
   summarize the pending customers.”

ChatGPT's exact callback URI is shown in its MCP management page; do not hardcode
an assumed callback or use a wildcard. DCR records the URI supplied by the client.
If a workspace chooses a pre-registered client, create it through Savia's OAuth
client administration, leave it untrusted (consent enabled), and register that exact
callback. It must allow the MCP resource and requested scopes. A read-only grant
cannot execute writes: reconnect with write authorization when needed.

See the official [OpenAI OAuth integration guide](https://developers.openai.com/plugins/build/auth)
and [Claude custom connectors guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Available operations

The existing `savia_list_crm_collections` tool discovers installed local, custom
and CRM-provider collections and their schemas dynamically. Its name is retained
for compatibility. Record query, read, aggregation, create, update, delete and
relation tools call the same API used by Savia, preserving its authorization and
provider capabilities. Adding an authorized collection does not require a new
MCP deployment or a tool per collection.

| Tool                            | Purpose                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `savia_list_employees`          | List active employees visible in the selected organization and global employees.       |
| `savia_invoke_employee`         | Execute a task with an employee's instructions, knowledge and collection restrictions. |
| `savia_get_employee_action`     | Read the caller's proposal status/result.                                              |
| `savia_confirm_employee_action` | Execute an unexpired proposal after explicit user approval; requires write scope.      |
| `savia_cancel_employee_action`  | Cancel the caller's pending proposal; requires write scope.                            |

Select the active organization in Savia's assistant settings. Membership is
rechecked when resolving this selection. Without a valid selection, employee
discovery exposes global employees only. Unknown, inactive or inaccessible IDs
fail rather than substituting a different employee. Discovery does not return
system prompts, model credentials or raw knowledge files.

Invocation accepts `employeeId`, `message` (up to 12,000 characters), and optional
`history` (up to 20 user/assistant messages). It returns text and pending proposals;
it does not persist a new conversation. Instructions and knowledge remain in Savia,
although the employee's authorized answer is shared with the external client.
The existing model configuration and associated model usage apply.

Employee-generated writes remain proposals with the existing five-minute expiry.
The client must show the exact proposal and obtain explicit user approval before
calling the separate confirmation tool with `confirmed: true`. Configure the
client to require approval for write tools: this argument is an explicit protocol
acknowledgment, not independent proof that a human clicked an approval button.
The server still enforces scope, action owner, expiry and one-time execution.
Internal employees never receive the external employee-invocation or confirmation
tools, preventing recursive agent calls or automatic self-approval.

## Authentication boundary

- Protected-resource discovery: `/.well-known/oauth-protected-resource/mcp`.
- Authorization-server discovery: `/.well-known/oauth-authorization-server/api/auth`.
- Authorization and token endpoints are advertised by Better Auth.
- MCP tokens have the exact audience `<SAVIA_API_RESOURCE>/mcp`.
- The private Auth binding verifies signature, issuer, audience, expiry and required
  identity claims, then signs a distinct API-audience token. Its lifetime is at
  most 120 seconds and never exceeds the external token's remaining lifetime.
- Only granted API scopes and the validated identity are copied. External cookies,
  session IDs and delegation headers are not forwarded. DPoP-bound tokens are
  rejected because this connection supports bearer tokens only.
- The public endpoint forwards to the existing private MCP Worker; it is not a
  public route on that Worker. API tokens cannot authenticate the public MCP URL.

The transport is stateless, including the local HTTP MCP process. Each request
is authenticated independently; there are no user credentials stored in a shared
MCP session. OAuth refresh is handled by the client, not by the MCP gateway.

## Local verification and troubleshooting

With local Auth/API and the existing MCP shared secret configured, use
`http://127.0.0.1:8787/mcp`. Cloud-hosted clients cannot reach your computer's
loopback URL; use the deployed HTTPS environment for account-level verification.

```sh
curl -i http://127.0.0.1:8787/mcp
curl http://127.0.0.1:8787/.well-known/oauth-protected-resource/mcp
pnpm --filter @savia/auth test
pnpm --filter @savia/mcp test
pnpm --filter @savia/api test
```

An unauthenticated MCP request returns 401 with a `WWW-Authenticate` discovery
challenge. A missing binding/secret returns 503; an internal transport failure
returns 502. Check the normal deployment bindings if discovery works but tool
calls do not. Employee invocation needs a configured model provider; failures or
truncated streams are reported as errors, with a 90-second stream limit.
Do not automatically retry writes following a connection interruption: inspect
the action status first.

The tests cover real signed token exchange, DCR, authorization-code PKCE, consent,
refresh, transport identity isolation and employee authorization. Actual connection
approval inside a user's Claude or ChatGPT account is a separate deployment smoke
test and is not established by the automated tests.
