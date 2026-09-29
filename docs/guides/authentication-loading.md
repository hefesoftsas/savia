# Authentication loading

The application boot splash, login redirect and OAuth form submission share the
logo, ring animation, dimensions, colors and message defined in
`packages/tenant-host/src/loading.ts`. The admin's `PwaSplash` renders the same
presentation used by the authentication worker's server-rendered loading state.
The static first-paint splash in `apps/admin/index.html` mirrors this appearance.

OAuth keeps its form mounted while a request is pending. It shows the loading
state until navigation begins, or restores the form when credentials fail,
second-factor input is needed, or MFA enrollment requires another step. Existing
tenant branding and the decorative login animation remain on the form. The
loading indicator exposes an accessible status and respects reduced motion.

The shared loading style is delivered through the existing authentication CSS
route; it does not require a new script or animation library. It represents
pending work and does not add a minimum display time or delay navigation.
