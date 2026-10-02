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

Explicit logout waits for the server sign-out and workspace cleanup before
clearing mounted queries and redirecting to authorization. Clearing auth queries
while asynchronous cleanup is still pending can trigger another authentication
check and repeated logout, leaving the current tab blank. Query cleanup still
runs if workspace cleanup fails.
