# Remote MCP Implementation Plan

**Goal:** Connect Claude and ChatGPT to authorized Savia collections and employees.
**Architecture:** Public API gateway to private MCP, with an Auth-owned token exchange.
**Tech stack:** Cloudflare Workers, Better Auth, jose, FastMCP, Hono, Vitest.
**Spec:** ../specs/2026-09-19-remote-mcp.md

## Constraints and review focus

Preserve current native/private MCP and existing API scopes. Never allow arbitrary
audience, subject, expiry, upstream URL, or forwarded identity headers. Do not
accept API tokens as MCP tokens. New registrations require consent and PKCE.
Employee invocation must fail closed on unknown, inactive, or out-of-tenant IDs.
Never report a failed or truncated model stream as a successful response.

## Tasks

- [x] Auth: write signed-token exchange and registration tests, implement the
      private exchange in `apps/auth/src/mcp-exchange.ts`, register the MCP resource
      and DCR policy in `oauth.ts`, and add the private worker route. Verify Auth tests.
- [x] Transport: test unauthenticated discovery, forged headers, upstream failure,
      and caller identity propagation. Add `apps/api/src/mcp-gateway.ts`, call it from
      the worker, route `/mcp` at the edge, and include it in deployment asset routing.
      Keep public MCP sessions stateless to avoid cross-user credential reuse.
- [x] Employees: add authorized public list/invoke API endpoints, bounded stream
      parsing and MCP list/invoke/confirm/cancel tools. Test tenant and status checks,
      prompt non-disclosure, pending confirmations, and no recursive agent calls.
- [x] Verify affected package tests and typechecks, generated deployment routing,
      and contract checks. Document the exact URL, OAuth flow, scopes, setup, and
      remaining account-specific end-to-end validation in `docs/remote-mcp.md`.

## Verification results

- Auth: 40 tests passed, including real DCR, consent, S256 PKCE, refresh and exchange.
- API: 415 tests passed across 66 test files.
- MCP: 35 tests passed, including concurrent caller isolation.
- Admin edge gateway: 6 tests passed; contracts: 57 tests passed.
- Auth, API and MCP TypeScript checks passed. MCP Cloudflare dry-run build passed.
- Initial concurrent full-suite runs hit timeouts; Auth and API passed when rerun
  sequentially with one worker. No test timeout configuration was changed.
- Independent security review findings (bound-token rejection and explicit employee
  selection) were fixed and covered by regression tests.
- Production deployment and real Claude/ChatGPT account connection remain separate
  operational validation; no live deployment was performed.
