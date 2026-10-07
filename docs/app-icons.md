# Application icons

Savia's application mark lives in `assets/brand/savia-mark.svg`. Generate the
favicon, Apple touch icon and PWA PNGs with `pnpm favicons:generate`.
The generator uses Sharp and works on macOS, Linux and Windows. It leaves the
application logo and the separately authored web manifest unchanged.

Normal icons fill 90% of the canvas with the four-leaf mark. The background is
transparent so only the mark itself shows; the dark leaves may be hard to see
on dark browser chrome. The SVG favicon stays crisp at small sizes; the ICO
contains 16, 32 and 48 pixel fallbacks.

Maskable icons use a separate composition: the complete mark stays inside the
central safe circle (80% diameter). Their background is transparent, so
launchers fill the silhouette with their own backdrop. Never label the normal
icon as maskable.

The static boot splash uses a dedicated opaque asset (`savia-splash-192-v1.png`)
so the dark lower leaves stay crisp and visible against both light and dark
splash backgrounds. All in-app presentation components, maskable icons and
touch icons retain transparent backgrounds to avoid unwanted opaque borders.

`apps/admin/index.html` and `apps/admin/public/site.webmanifest` reference the
versioned assets. When changing their artwork, bump those asset URLs so browsers
and installed applications can discover the new icons. Never reuse a retired
versioned name for different bytes: the gateway serves these PNGs as immutable
for a year, so clients would keep the old bytes. Retain previously deployed
files in `public/` so older manifests keep resolving. Keep the manifest `id`,
start URL, scope and shortcuts stable. Installed launchers may refresh their
icons later than browser tabs; reinstalling the PWA refreshes the installed icon.
