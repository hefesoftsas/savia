# Application icons

Savia's application mark lives in `assets/brand/savia-mark.svg`. Generate the
favicon, Apple touch icon and PWA PNGs with `pnpm favicons:generate`.
The generator uses Sharp and works on macOS, Linux and Windows. It leaves the
application logo and the separately authored web manifest unchanged.

Normal icons fill 90% of the canvas with the four-leaf mark. Their background
is transparent so only the mark itself shows; the dark leaves may be hard to see
on dark browser chrome. The SVG favicon stays crisp at small sizes; the ICO
contains 16, 32 and 48 pixel fallbacks.

The Apple touch icon and maskable icons use opaque white backgrounds. The
maskable composition keeps the complete mark inside the central safe circle
(80% diameter); its white background bleeds to the edge so iOS and Android do
not composite transparent pixels onto black. Never label the normal icon as
maskable.

`apps/admin/index.html` and `apps/admin/public/site.webmanifest` reference the
versioned assets. When changing artwork, bump the affected asset URLs so
browsers and installed applications can discover the new icons. Keep older
versioned files available: they may already be cached with a one-year immutable
cache policy. Keep the manifest `id`, start URL, scope and shortcuts stable.
Installed launchers may refresh their icons later than browser tabs;
reinstalling the PWA refreshes the installed icon.
