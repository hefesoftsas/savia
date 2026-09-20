# Public forms

Owner: Savia platform team. Last reviewed: 2026-09-19.

## Publishing

Forms remain private until a platform administrator opens a screen's configuration,
expands **Enlaces públicos**, confirms the published snapshot, and creates a link.
The administrator can set an expiration and a daily submission budget, copy the
canonical public URL, and revoke each link independently. Each active link can also
show a QR code encoding the same canonical URL, with SVG and PNG download for
print or in-person sharing. The default budget is
25 submissions per link per UTC day. Existing links do not inherit later edits;
review and publish a new link after changing a form. Revoke the previous link when
replacing it.

Native collections support plain text, numeric, email, date, boolean, and static
select fields. Hidden, read-only, computed, secret, relational, remote-option,
file, and scripted fields are not exposed. Unsupported required fields block
publication. Collection-bound screens cannot accept public submissions. A native
submission creates a CRM record; it never executes request-page scripts, lookups,
or arbitrary plugin actions. Existing CRM validation also applies at submission.

The insurance quote screens support a dedicated public form. Configure the plugin
and enabled products before publishing. The server freezes the allowed products
and checks the installed extension and settings version on use. Changing that
configuration requires republishing. Visitors cannot choose connections, actions,
execution mode, or provider flows. They enter vehicle and applicant information
manually; private vehicle lookup endpoints remain protected.

Quote links for `cotizador_por_pasos` render the public plugin wizard with the
published product snapshot and three steps: vehicle, applicant and driver, and
contact and quote. The public experience omits authenticated history, CRM
records, provider configuration, private vehicle lookup, and admin navigation.
Changing quote settings or enabled products still invalidates the frozen
snapshot and requires publishing a new link.

By default the response is only an acknowledgement and submission reference.
For quotation links, administrators may explicitly enable a limited result for the
current submission: insurer/product labels, premium, currency and supported coverage
labels. Raw provider responses, credentials and customer identifiers are never
returned. A single submission can call each enabled provider once, so its cost
scales with the number of enabled products. Daily budgets count submissions, not
provider calls; start with a small budget for public quotations.

## Deployment configuration

1. Apply D1 migration `0054_public_forms.sql` using the normal migration pipeline.
2. Create a Cloudflare Turnstile widget for the canonical public hostname.
3. Configure `TURNSTILE_SITE_KEY` and secret `TURNSTILE_SECRET_KEY` on the API worker.
   Keep the secret outside source control and frontend environment variables.
4. Set `SAVIA_PUBLIC_ORIGIN` to the canonical HTTPS origin serving the admin gateway
   and public pages. Links always use this origin, even when created from an agency
   subdomain. Configure preview and production independently.
5. Deploy API and admin together. The production configuration generator includes
   the `PUBLIC_FORMS_RATE_LIMITER` binding (30 requests per minute per IP).

Missing configuration fails closed. Public-host deployments reject Turnstile test
keys; fake Siteverify responses are injected only by tests. Captcha validation uses
Cloudflare's server-side verification, checks hostname, `public_submit` action and
link identifier, and has a timeout. Browser-only captcha validation is insufficient.

## Security and reliability boundary

The public page loads independently of the administrative app: no session bootstrap,
workspace replica, IndexedDB initialization, or administrative synchronization.
Public requests omit credentials. The gateway serves the public page as an asset
route and forwards public API requests to the API worker. API reference documentation
is generated from the route schemas and available in Scalar.

The anonymous API only exposes the intentionally published field definition and
accepts submissions. It provides no collection listing, record lookup, history,
update, or delete capability. Management remains authenticated and restricted to
platform administrators. Public responses are not cached and are marked noindex.
The random link token cannot be used as an administrative credential.

Before any side effect, D1 atomically reserves the submission and enforces per-link,
per-IP (20/day), and per-tenant (1,000/day) quotas. Captcha reuse is blocked globally.
These persistent quotas complement the burst limiter. Failed or interrupted attempts
consume budget because provider calls may already have occurred. Request bodies are
limited to 32 KiB; only declared primitive field values are accepted.

Repeated submission identifiers never re-execute side effects. An exact replay with
the original captcha proof can return its saved acknowledgement; a changed proof or
incomplete attempt returns a conflict. The browser retains the submission identifier
after an uncertain response and does not silently start a new request. Revocation
blocks new reservations; it cannot undo provider calls already started.

Submission reservations and acknowledgements are retained to preserve deduplication.
They contain hashes instead of raw IP addresses/captcha tokens, and no native form
values. Native values live in the protected CRM record. Quote execution inputs remain
in protected extension-run storage; results there use the same safe projection.
Monitor D1 storage and provider usage as traffic grows. Do not delete reservations
for an active link without considering the loss of deduplication guarantees.

## Verification

API tests use real local D1 with fake captcha verification and fake quote executors.
They cover authorization, strict projection, captcha binding, expiry/revocation,
concurrent quota enforcement, durable idempotency, and request limits. Browser
component tests cover publication/revocation, QR toggle/download, captcha lifecycle, bounded result
rendering, and duplicate-click/network-retry behavior. No live provider calls or
customer forms are required for verification.

## Self-hosted Docker CAPTCHA

The native Docker runtime uses ALTCHA instead of requiring Turnstile credentials. Challenges are generated and verified locally, expire after five minutes, and are bound to the form, public origin and submission action. The receipt stores a canonical proof identity to prevent replay via alternate encodings. An uncertain retry keeps the exact original proof and submission ID so a saved receipt can be returned after expiry. The widget and its worker are bundled locally. The existing submission-only API, field validation, rate limits and quotas remain enforced. Cloudflare keeps Turnstile as its default. See the [Docker deployment guide](guides/self-hosted-docker.md).
