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
