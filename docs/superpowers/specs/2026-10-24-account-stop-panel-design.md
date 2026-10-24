# Account emergency stop panel

Provide an independent control panel on the existing Cloudflare cost guard at
`/control`. The operator chose the protected Cloudflare panel over GitHub Actions
to avoid runner queues and keep the control reachable when applications stop.

The panel uses the existing guard administrator credential, held only in page
memory and sent through Authorization headers over HTTPS. It never embeds keys,
places them in links, persists them in browser storage, or creates new access.
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
