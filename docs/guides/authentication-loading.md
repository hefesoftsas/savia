# Authentication loading

The application boot splash, login redirect, OAuth callback and OAuth form
submission share the logo, ring animation, dimensions, colors and message
defined in `packages/tenant-host/src/loading.ts`. The admin's `PwaSplash` renders
the same presentation used by the authentication worker's server-rendered
loading state. The static first-paint splash in `apps/admin/index.html` mirrors
this appearance. If the OAuth callback fails, the admin keeps its error message
and return-home action.

OAuth keeps its form mounted while a request is pending. It shows the loading
state until navigation begins, or restores the form when credentials fail,
second-factor input is needed, or MFA enrollment requires another step. Existing
tenant branding and the decorative login animation remain on the form. The
loading indicator exposes an accessible status and respects reduced motion.

Opening the authentication worker's login page directly can omit the signed
OAuth request. After successful authentication (including any second factor),
the page returns to the configured admin login route to start a fresh
authorization. The same recovery applies after social or SSO authentication.
It does not call the OAuth continuation endpoint without a signed request;
normal signed requests keep their original continuation and destination.

The API forwards the optional signed `oauth_query` on password sign-in, TOTP
verification and recovery-code verification. Better Auth validates this context
and uses it when creating the session to complete the requested authorization.
Dropping the query at the API boundary leaves `prompt=login` pending: a valid
second factor then returns to login instead of the application's callback.

If second-factor verification returns `INVALID_TWO_FACTOR_COOKIE`, the login
page starts a fresh authorization through the configured admin login route,
preserving the tenant host. MFA challenges expire after five minutes and are
single-use; submitting codes against an invalid challenge cannot restore it.
An incorrect authenticator code keeps the form available for another attempt.
Both authenticator and recovery-code sign-in use this recovery path. The client
reads Better Auth's `code` field as well as OAuth's `error` field to distinguish
an invalid challenge from an incorrect code.

The shared loading style is delivered through the existing authentication CSS
route; it does not require a new script or animation library. It represents
pending work and does not add a minimum display time or delay navigation.

Admin API requests have a 15-second deadline; JSON and OAuth session requests
also apply that deadline while reading the response body. Page-file uploads and
companion recording uploads use a five-minute deadline to allow larger files
and slower connections to finish. If the application splash or a route fallback
remains visible for 15 seconds, it replaces the spinner or skeleton with
actions to retry or return to sign-in. The users list also shows a retry action
when its data request fails, including when it reaches the request deadline.

Explicit logout waits for the server sign-out and workspace cleanup before
clearing mounted queries and redirecting to authorization. Clearing auth queries
while asynchronous cleanup is still pending can trigger another authentication
check and repeated logout, leaving the current tab blank. Query cleanup still
runs if workspace cleanup fails.

Logout still rotates the session read generation to invalidate protected reads,
but only principal replacement changes the application subtree key. Keep React
Admin mounted during logout so its active logout hook can finish cleanup and
redirect. Remounting that boundary on every session clear restarts Office
availability and appearance reads and can cause a repeated logout/request loop.

If the browser does not finish an OAuth redirect within ten seconds, the page
restores its content and exposes **Continue to Savia** as a normal link to the
same server-provided destination. It preserves the authorization, PKCE and MFA
requirements; the link does not create a different session or grant.

Profile refresh and background route reads do not re-enter the application boot
splash. Actual principal replacement rotates the authenticated subtree and
discards previous-owner state. Dedicated tenant lookup has a separate boundary:
its initial failure offers retry and prevents protected default-scope reads while
keeping sign-in available. See [stable background refresh](background-refresh.md)
for read retention and authorization-denial rules.

Explicit sign-out immediately shows a branded “Signing out…” transition and
makes the workspace inert while server sign-out and cleanup finish. The workspace
stays mounted so pending auth work can complete. The transition adds no artificial
delay, respects reduced motion, and releases its busy state if sign-out fails.
Automatic access failures do not display this explicit sign-out transition.

On a callback URL containing an OAuth code and state, early access-token reads
join the single callback exchange before attempting renewal. A background read
must not start a refresh against the canonical callback origin while a tenant
login is being exchanged. The session still returns to the initiating tenant.

When a same-origin or recognized public-origin refresh request has no renewal
cookie, the API returns 401 without looking up OAuth client metadata from the
auth worker. Other cross-origin clients retain configured-client CORS validation.
This avoids a provider initialization delay before an inevitable login redirect.

The auth worker reports `auth_schema`, `auth_bootstrap` and `auth_dispatch`
durations in its `Server-Timing` response header. Compare those phases with the
request's total time before attributing a delay to schema or bootstrap work; a
slow response alone does not identify which phase is responsible.

Successful API `GET /api/auth/admin/authorize` redirects report `oauth_client`
(admin OAuth client metadata lookup), `oauth_transaction` (PKCE transaction
creation and persistence), and `oauth_authorize` (the authorization redirect
service call) in `Server-Timing`. These values are durations only; the header
does not include request URLs, state, tokens, or cookies.

Protected API requests without an `Authorization` header or any `Cookie` are
rejected before the API calls the internal session service. Requests with
cookies still validate their session with the auth worker.

## Deployment preparation

Managed preview and production releases prepare Auth before opening application
traffic. The frozen Auth configuration includes `SAVIA_AUTH_DEPLOYMENT_REVISION`,
set to the exact source commit. After publishing Auth, the managed publisher runs
`scripts/initialize-auth-deployment.mjs` through a short-lived authenticated service
binding. The initialization endpoint requires the internal bridge credential and
an exact revision match. Credentials are never written into the probe configuration
or command arguments.

Preparation performs schema migrations, bootstrap client reconciliation and OAuth
resource seeding, then records readiness in Auth D1. Readiness includes the revision,
a SHA-256 configuration fingerprint and public client metadata. Normal managed
requests load this record once per handler and do not rerun migrations or bootstrap
writes. `auth_readiness` measures this lookup; managed requests omit
`auth_schema` and `auth_bootstrap` because those phases ran at deployment. Missing or mismatched readiness returns 503 instead of preparing Auth during
login. A failed preparation blocks API publication and uses the existing release
recovery path. Previous readiness records remain available for rollback. Local and
branch environments without the managed revision retain lazy initialization.

Preparation also completes Better Auth's explicit schema validation before
recording readiness. Managed request handlers disable its automatic background
schema check. A short metadata request must not start request-owned introspection
that later authentication requests would await after the first request has ended.
Runtime handlers rely on the validated readiness record; deployment and local
initialization retain schema validation.

The backup write barrier exempts conservative, single-statement `SELECT` reads.
Previously, even tenant and login-policy reads acquired and released durable
write permits, adding two coordinator calls per query. Writes, ambiguous SQL,
batches, and `exec` still acquire permits; `UPDATE ... RETURNING` remains guarded
even when executed through a read-shaped method such as `first()`. Policy reads
remain current on every request and are not replaced with a cross-request cache.
The gate client also cancels unused response bodies after successful permit
release and before retrying failed coordinator responses. This prevents
unneeded internal response streams from accumulating. It is a resource-lifecycle
hardening change; current live evidence does not establish it as the cause of
the reported pending Auth requests.

The API login proxy also reports tenant-context lookup, registration preflight and
the final Auth round-trip in `Server-Timing`, alongside Auth's own phases. Tenant
resolution is reused within the request; branding, tenant validation and registration
availability keep their existing checks. Use these measurements to distinguish
remaining database/network time from deployment preparation.

The public login context resolves the tenant and its optional branding in one
database query, preserving canonical-slug priority, aliases and active commercial
tenant filtering. Registration preflight runs independent settings, email
availability and password-policy reads concurrently. These reads remain scoped
to the request, so policy changes do not wait for a cross-request cache to expire.

A temporary OAuth renewal failure (network error, rate limit, provider server
error or malformed token response) returns `503 AUTHENTICATION_UNAVAILABLE` and
preserves the renewal cookie and origin record. A later retry can reuse that
session. Only a confirmed `invalid_grant` or `invalid_token` from the provider
clears renewal state and returns 401. Deployment unavailability must not sign
users out permanently.
