# SPA build size and startup payload

The Admin build retains every brand icon and variant. A build-time transform
replaces the generated per-icon renderer with one shared React factory and interns
identical SVG subtrees and long repeated geometry strings. It preserves geometry,
colors, nested styles, SVG overrides, fragment ID isolation and forwarded refs.
Unknown future package formats fall back to the original module. Catalog-wide
round-trip tests check every installed icon and variant against the source data.

Do not combine all dependencies in one catch-all vendor chunk. Optional editors,
documentation and formatting libraries must remain behind their route imports.
The compact brand factory belongs to the shared icons chunk explicitly so the
extension host cannot absorb it into its much larger manually selected chunk.

The gateway serves canonical asset URLs. Cloudflare negotiates transport
compression; it does not use the former manually generated `.gz` and `.br`
copies. Removing these unused copies reduces artifact size without changing
asset URLs. Office runtime compression metadata is separate and unchanged.
See [Cloudflare content compression](https://developers.cloudflare.com/speed/optimization/content/compression/).

Imported upstream marketing screenshots and demo media with no references in
Savia's application or templates are omitted. Workflow templates, viewers, native
flows, both TypeScript services and the extension host remain available. The
TypeScript workers contain different compiler versions and service adapters;
they are retained rather than treating their similar sizes as proof of duplicates.

## Measure and enforce

After a production build, run:

```sh
node scripts/measure-spa-build.mjs apps/admin/dist /tmp/savia-build-report.json
node scripts/check-spa-build.mjs apps/admin/dist
```

The report separates original files, all published files and compression sidecars.
Startup payloads follow static ESM imports from the emitted HTML and, for an
authenticated My Day, the private app and My Day entries, including CSS in
Vite's dynamic-entry preload metadata. Each file is compressed
independently at gzip level 6 and Brotli quality 5. This is a reproducible dependency
payload measurement, not a browser timing, an exact CDN encoding measurement or
a Web Vitals score. API responses, images, idle route prefetch and background
service-worker cache population are outside those startup payloads. These must
be measured separately for a network waterfall or real-user timing comparison.

Installers under `downloads/` are separate artifacts and do not count toward
the SPA size budget. The build verification rejects compression sidecars,
oversized startup dependencies and optional editor/Flows code in My Day's initial
dependency closure. Run checks serially with a bounded Node heap on local machines.

These changes do not provision services, deploy an environment, or enable Flows.
