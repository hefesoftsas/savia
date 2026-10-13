# SPA build optimization verification

Baseline: `f3648219cef135a8285cf0255b6bfa0480a12136` (same source tree as
merged main `478704c95dda0fcc81511f2e6193cc490a0ffb10`). Both distributions
were built locally with the same installed dependencies and a 2 GiB Node heap.
VSIX preparation was excluded from both comparable Vite builds.

| Measurement                                  | Before, bytes | After, bytes | Reduction |
| -------------------------------------------- | ------------: | -----------: | --------: |
| Original files                               |    92,547,762 |   77,729,589 |     16.0% |
| Published directory (including old sidecars) |   140,419,557 |   77,729,589 |     44.6% |
| Boot JS/CSS dependency payload, gzip         |     3,342,459 |    1,149,384 |     65.6% |
| My Day JS/CSS dependency payload, gzip       |     3,766,385 |    1,608,004 |     57.4% |

The original-file measurement includes public files not listed in Vite's console
summary; that is why the baseline is 92.55 MB rather than the previously quoted
91.09 MB console total. Published size counts `.gz` and `.br` copies as separate
files; they added 47,871,795 bytes before and zero after.

Startup numbers measure the emitted JS/CSS static dependency closure, compressed
per file. They exclude API responses, images, optional idle route prefetch and
background service-worker precaching. They are not browser timings or exact CDN
transfer sizes. Browser smoke checked the compiled application for JS errors; a
full authenticated local journey requires the local backend, which was not
running. Live preview's My Day rendered before changes with the current session.

Cold HTTP requests to preview's canonical vendor URL negotiated both Brotli and
gzip without requesting sidecar paths. Decompressing both responses produced
7,598,731 bytes and the same SHA-256
`36e1ddd914ba14cb99ba9ec40bbaa453680c870f49cf62635c76566b26edad24`. The gateway
has no sidecar selection code. Cloudflare transport compression is already
configured; no service or configuration was activated.

The minified catalog was compacted without deleting icons. All 6,523 installed
modules and all variants were checked by exact data round trips. The shared
renderer retains props, refs, nested styles, titles, variant fallback and gradient
ID isolation. An initial prototype accidentally pulled the shared icon factory
into the optional editor chunk; assigning the factory to the icons chunk fixed
that before the final measurements.

Similar-sized TypeScript workers were retained: Monaco's compiler is 5.4.5 while
the Savia completion service uses its own pinned TypeScript dependency and adapter.
Unifying them without a language-service compatibility change would remove
features or change diagnostics.

Flows enablement and execution flags remain false in preview. No deployment,
resource provisioning, external execution or data mutation was performed.

## Browser network measurement

Two fresh loopback origins served the before/after builds with gzip level 6.
A local audit script wrote resource timing counters to a hidden DOM output after
eight seconds; CUA read that output. There were zero cached resources in both
loads. JS/CSS/image resource body downloads were **3,667,076 → 1,511,534 bytes**
(**58.8% lower**), with 62 → 61 requests. Transfer counters including the browser's
header allowance were 3,685,676 → 1,529,834 bytes. The audit script itself, HTML,
API calls and service-worker background traffic were excluded. There was no
authenticated local backend, so this measures loading through the auth boundary,
not a populated authenticated My Day. Both builds reported no captured JS errors.

## Validation

- Complete Admin suite: **380 files, 2,513 tests passed**, max one worker and
  a 1.5 GiB Node heap. Existing Monaco sourcemap and jsdom navigation warnings
  did not fail tests.
- Flows editor suite: **19 files, 120 tests passed**, serial execution.
- Admin `tsc --noEmit`: passed with a 2 GiB heap.
- Full `build:assets`, including VSIX preparation and the new build-budget gate:
  passed with a 2 GiB heap. Installers are excluded from comparable SPA figures.
- Measurement and preview-policy/pipeline checks: **8 tests passed**.
- Optional-library chunk regression: observed failing under the previous
  catch-all vendor rule and passing after preserving the lazy boundary.
- Deferred startup CSS regression: observed failing before parsing Vite preload
  metadata and passing after; template-literal dynamic imports are covered.
- Impeccable detector: no findings on changed implementation targets.
- Read-only final review: deferred-CSS undercount was fixed and re-reviewed;
  no remaining actionable findings.

Machine-readable baseline, optimized payload and browser-network counters are
under `artifacts/2026-10-12-spa-*.json`. The build-budget gate runs from both
Admin production build commands and the existing preview asset pipeline.
