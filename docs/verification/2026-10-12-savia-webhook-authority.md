# Savia webhook execution authority verification

Date: 2026-10-12. Scope: the existing HTTP Request/Webhook triggers can use native
Savia collection nodes with an explicit execution identity. The user approved
implementation and retained the local Miniflare-only constraint and no approval
pauses. This is a bounded extension of existing trigger, host authorization,
runtime and collection behavior.

## Design

An authenticated tenant manager explicitly enabling a saved HTTP workflow binds
its execution principal in Flows D1. Migration 0068 stores workflow/tenant/user,
active state and timestamps. The inbound API key continues to authenticate each
request. Before executing a bound flow, the private Savia host checks the user's
current principal, tenant, membership and management permission. Native nodes
reuse their existing current collection/row/field checks and receipt transactions.
Disable deactivates the binding; re-enable assigns the current enabling user.
Caller-supplied identity fields are ignored.

Legacy HTTP graphs without native Savia nodes can retain API-key-only execution
when no binding was ever assigned. A graph with native nodes requires explicit
authority. An assigned inactive/revoked authority never falls back to a generic
API-key user. The Integrate dialog reads backend state and explains how access is
assigned. HTTP Request forces Worker execution and HTTP Webhook forces durable
execution. A Savia-only adapter adds the webhook body Blob output without changing
the 526 pinned imported node implementation files.

## Acceptance checks

The real Miniflare test `apps/flows/scripts/webhook-collections.test.mjs` uses
all migrations, actual host/private bindings, actual public HTTP gateway,
R2-backed graph storage and actual Worker/Workflows execution. Its first run
failed at the intended assertion: an unbound native graph returned a failed
execution with HTTP 201 instead of rejecting admission with HTTP 409.

The final run passed body-to-JSON-to-native-create execution for both forced
runtime modes, enabling-user attribution and reassignment to a second real
synthetic host manager, ignored forged caller identity, missing/foreign/revoked
API key rejection, disabled workflow rejection, current host role revocation,
and persisted authority after restart. Authentication data stayed absent from
captured inputs and execution history.

## Final checks

- Flows API: 866 tests passed in 64 files.
- Flows app: 96 tests passed in 13 files.
- Full local Miniflare/controller suite: 12 tests passed, including the prior
  native collection integration and the new HTTP authority checks.
- API and app TypeScript checks passed. The Worker dry-run and child app builds
  passed. The Admin host build includes the updated child assets.
- Pinned source verification passed: 1,897 imported files, 526 unchanged node
  implementation files and 48 categories. No dependency change was needed.
- A bounded independent review found no material permission/authority issue.
  Scoped Prettier and `git diff --check` pass. Root-wide lint was not re-run;
  its pre-existing failure is documented in the original Flows verification.

Native Chrome verified the body port and wiring, unconfigured access guidance,
disable/re-enable through the actual UI, and the updated Integrate dialog's
backend-owned `configuredBy: you` state. A request to that browser fixture's
actual public webhook then completed durably and created a record attributed
to `browser-verification`; its temporary API key was deleted. The dialog's
cURL layout fits the 390-by-844 mobile viewport. Switching the sample-code tabs
through native mobile automation was not established; pointer wiring and full
authenticated Admin login remain unverified.

The existing host authorizer intentionally fails closed. Its boolean result
currently maps both revoked access and host unavailability to HTTP 403 with
generic wording; no run starts in either case.

## Limits

No external service, public tunnel or billable binding is activated. No live
provider signature/transport or authenticated full Admin login is established by
the synthetic local fixture. Incoming deliveries are separate runs; native
receipts protect retries inside a run, not duplicate HTTP deliveries across runs.
Disable does not cancel an already admitted run. The inherited unfinished Worker
crash replay limits remain in the native collections verification record.
