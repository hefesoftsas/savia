# Account emergency stop panel

Provide an independent control panel on the existing Cloudflare cost guard at
`/control`. The operator chose the protected Cloudflare panel over GitHub Actions
to avoid runner queues and keep the control reachable when applications stop.

The panel requires Cloudflare Access with the Cloudflare identity provider,
account membership and the administrator email allowlist. The Worker trusts only
platform-verified `ctx.access`, never identity headers from callers. Browser
requests use same-origin sessions at `/control/status` and `/control/stop`; the
server supplies the existing administrator credential only on internal forwarding.
The credential never reaches the browser. Machine APIs retain bearer access.
The authoritative stop state stays in the existing singleton Durable Object.

An authenticated, explicitly confirmed POST `/stop` persists a manual stop latch
before discovery or any external call, without depending on billing. Existing
pause actions cover every environment in this account. Scheduled checks keep
enforcing the latch, including newly discovered services. No resume action exists.
Preserve the guard, backup coordinators and daily cleanup exception. Preserve
recovery snapshots and all application data. Show current status, protected
services, per-target action outcomes and incomplete discovery/actions honestly.
In-flight requests may finish; this is not a billing cap or resource deletion.

Use the existing Worker and credentials, with no new bindings, databases,
inference providers or paid infrastructure. Deploy only the guard. Application
deployments remain disabled and existing services remain paused.
