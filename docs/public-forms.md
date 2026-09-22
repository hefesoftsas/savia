# Public forms

Owner: Savia platform team. Last reviewed: 2026-09-19.

## Publishing

Forms remain private until a platform administrator opens a screen's configuration,
expands **Enlaces públicos**, confirms the published snapshot, and creates a link.
The administrator can set an expiration and a daily submission budget, copy the
canonical public URL, and revoke each link independently. Revoked or expired
links can be permanently deleted with their submission history; active links
must be revoked first so in-flight deduplication is never dropped silently. Each active link can also
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
contact and quote. The birth date offers quick age presets mirroring the
embedded wizard. The public experience omits authenticated history, CRM
records, provider configuration, and admin navigation; the private vehicle
lookup endpoints stay protected and only the safe projection above is public.
Changing quote settings or enabled products still invalidates the frozen
snapshot and requires publishing a new link.

The public wizard preloads vehicle data from the plate through
`POST /api/public/forms/:token/vehicle-lookup`, mirroring the embedded plate
lookup: typing the plate and pressing the search button (or leaving the field
with at least 3 characters) fills the Fasecolda code, production year, and
declared values, marking them
as autocompleted. A malformed plate names the exact field instead of calling
the lookup. The server runs the fixed plate-lookup
flow from the current trusted settings — visitors can never select actions,
connections, or flows — and returns only the plate plus those fixed vehicle
fields; raw provider output stays hidden. The lookup needs no CAPTCHA because
it happens before the final verification step, so it is bounded by the burst
rate limiter and strict plate format instead of submission quotas.

City fields offer DANE autocomplete through
`GET /api/public/forms/:token/cities?search=`, scoped to the same quote link.
Pressing Enter selects the first suggestion and the clear button resets the
field. DANE codes are public reference data, so the endpoint returns a bounded list
of code/city/department triples with no upstream internals and no provider
cost. Applicant identity fields stay manual: looking up CRM records by
document number would disclose personal data to anyone typing an ID, so that
capability remains authenticated-only.

By default the response is only an acknowledgement and submission reference.
For quotation links, administrators may explicitly enable a limited result for the
current submission: insurer/product labels, premium, currency and supported coverage
labels. Coverage bullets come from the live provider breakdown when present;
otherwise they fall back to the frozen plan catalog so each card still
describes its policy (never quote numbers, raw responses, or customer data). The public results render the same comparator language as the embedded
wizard (insurer cards ranked cheapest-first, insurer filter, coverage bullets),
without quote numbers, history, or retry actions. Visitors can print the
results to PDF from the browser; the print stylesheet keeps only the reference
and the quotes. While providers respond, the wizard shows a live waiting state
with elapsed time instead of a bare spinner. Raw provider responses, credentials and customer identifiers are never
returned. A single submission can call each enabled provider once, so its cost
scales with the number of enabled products. Provider calls run with bounded
concurrency (10 at a time) so the visitor wait stays flat as products grow. Daily budgets count submissions, not
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

## Local development

The local stack (`pnpm dev`) sets `SAVIA_DISABLE_CAPTCHA=1`, which skips
anonymous verification so links can be published and submitted without Turnstile
credentials. The bypass is honored only when `SAVIA_PUBLIC_ORIGIN` is a localhost
origin; with any other origin the flag is ignored and the normal provider
configuration applies. Preview and production therefore always fail closed when
unconfigured. The public page reports `captchaProvider: "disabled"`, mounts no
widget, and submits immediately. Never set `SAVIA_DISABLE_CAPTCHA` outside local
development.

For the same reason, `pnpm dev` sets `SAVIA_MOCK_QUOTES=1` (override with
`SAVIA_MOCK_QUOTES=0`): quote execution and plate lookup return fixed
simulation data instead of calling providers, so the whole public flow can be
exercised without credentials. Availability, policy, and validation checks
still run; only provider I/O is faked, and the fixture is constant on purpose
so it can never pass as a real provider response. Never set
`SAVIA_MOCK_QUOTES` outside local development.

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
incomplete attempt returns a conflict. Failed submissions keep their safe server
status (validation, provider, or policy messages) instead of a generic error;
only unexpected failures stay a sanitized 503 with no provider details. The browser retains the submission identifier
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
