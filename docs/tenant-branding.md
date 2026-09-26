# Tenant branding

Owner: Savia platform team. Last reviewed: 2026-09-19.

Commercial tenants can customize their public identity without changing authentication
or access to application data. Open **Administración → Identidad del espacio** from the sidebar.
Platform administrators can configure any active commercial tenant. Active tenant
administrators (`tenant_admin` or `agency_admin`) can configure only their own tenants.
Other members may read the saved configuration but cannot change it or upload images.
When no commercial organization is available, platform administrators can start tenant
creation from this page; other users are directed to request access from a platform
administrator.

The guided editor supports a display name, logo, login cover image, login Lottie
animation, welcome title, welcome text, primary color, and accent color. Preview
changes before saving. The
branding display name does not rename the tenant's legal/administrative name or slug.
Changes are saved explicitly; a version conflict requires reloading the saved version
before overwriting another administrator's changes.

The tenant hostname resolves the public identity. The canonical platform host keeps
Savia's identity, except authentication pages initiated from a tenant hostname: those
use the validated OAuth return-origin cookie to retain the tenant identity. Unconfigured tenants use their existing tenant name and default
colors. Unknown or inactive tenants do not expose a branding record. Branding does
not grant access to a tenant, bypass hostname checks, or change OAuth, passwords, MFA,
recovery or consent behavior.

## Login and application

The API resolves branding before forwarding authentication pages and their stylesheet
to the auth worker. It removes any caller-supplied branding header and supplies a
validated, encoded public identity. Authentication pages render the brand on the
server; arbitrary HTML, scripts, CSS and third-party images are not accepted. If a
branding lookup fails, authentication remains available with Savia's default identity.

The default web login shows Savia's animated logo and wordmark on a navy panel. The
Lottie player, animation JSON and wordmark font are served from the admin site's
public assets at `/login/`, under the same origin as the login. The animation plays
once and pauses while the tab is hidden. Visitors who prefer reduced motion see its
completed frame. A tenant can upload its own Lottie JSON animation (validated,
up to 2 MiB) to replace Savia's emblem on its login; the Savia wordmark and robot
greeting are hidden while the custom animation is active, and the custom animation
takes precedence over the tenant's login cover image. Removing the animation
restores Savia's default. Tenant title, welcome text, logo and colors remain
unchanged.

Pointer hover briefly pulses the emblem and animates the `ia` in the wordmark. Holding
the pointer over the emblem or wordmark for three seconds reveals a second Lottie
animation of Savia's robot greeting the visitor. Leaving before the delay cancels the
greeting. Touch and reduced-motion visitors do not trigger the hover animations.

Inside the application, a shared provider reads the public identity for the current
host and applies its display name, logo and primary colors. Theme mode remains a
personal preference. The personal palette selector is hidden when the tenant controls
the colors. Foreground colors are computed for contrast, and tenant styles are removed
when the provider changes host or unmounts. Branding adds no persistent browser cache.

## Images and public boundary

PNG, JPEG and WebP uploads are limited to 2 MiB and checked by file signatures rather
than the supplied MIME type alone. SVG and arbitrary URLs are not supported. Login
animations are Lottie JSON files limited to 2 MiB and validated as plain JSON with a
Lottie shape (`v`, `fr`, `ip`, `op`, `layers`) rather than by MIME type alone. Files
are stored in R2 under tenant-specific random keys, with ownership tracked in D1.
Only an asset belonging to the same tenant and matching its logo/cover/animation
purpose can be saved. An uploaded file becomes publicly readable only when the saved
branding references it; the editor uses a local preview while changes are pending.

Each tenant can retain at most 20 images (40 MiB maximum). On a subsequent upload,
unused images older than 24 hours are removed; currently published images are retained.
Failed storage operations retain a cleanup marker and continue counting against the
limit until deletion succeeds. Tenant deletion checks restrictive database references before removing its images; a cleanup
failure leaves the tenant inactive and requires retrying deletion.

Public endpoints expose only branding and published images. They cannot list tenants,
read tenant records or retrieve arbitrary R2 objects. Responses prevent MIME sniffing,
uploaded images are served as images with a restrictive content security policy,
public branding is served with edge caching (`public, max-age=60, s-maxage=300, stale-while-revalidate=600`),
and published assets are cached immutably (`public, max-age=31536000, immutable`)
keyed by their unique asset UUID. The editor reloads the fresh configuration immediately on save.
The generated OpenAPI/Scalar document is the API reference.

## Deployment and verification

Apply migrations `0055_tenant_branding.sql` and `0074_tenant_branding_login_animation.sql`
(plus native PostgreSQL migration `0015_tenant_branding_login_animation.sql` for
self-hosted installs), then deploy the API, auth worker and admin from the same
revision. The feature uses the existing D1 and R2 bindings and requires
no new secret or paid service. Each environment keeps its own branding configuration.

Tests cover tenant ownership, active memberships, upload validation and ownership,
public projection, optimistic concurrency, forged proxy headers, SSR escaping,
contrast, provider cleanup, explicit saves and conflict handling. Verification must
not alter real customer branding or publish customer images without a specific request.
