# Runtime ownership compatibility probe

Date: October 19, 2026.

This is evidence for the [environment ownership design](2026-10-19-pulumi-environment-ownership-design.md), not a completed lifecycle implementation.

## Scope

The probe used a private local Pulumi backend and four new Workers under the
exact prefix `savia-iac-fixture-oct19a`. The Workers had neither public subdomains
nor preview URLs. No existing domains, application Workers, data resources or
remote checkpoints were modified. One fixture Worker published a synthetic
`FixtureStore` Durable Object class through Wrangler.

The installed and exercised versions were Pulumi CLI 3.268.0, Cloudflare provider
6.22.0 (resolved by the existing infrastructure lockfile), and Wrangler 4.127.1.

## Results

| Check                                                                     | Result                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------- |
| Create four native Worker identities with `force:false`                   | Passed                                                |
| Publish code and a SQLite Durable Object through Wrangler                 | Passed                                                |
| Refresh and preview after Wrangler publication                            | Five resources unchanged; no desired update           |
| Delete the namespace-hosting Worker using native Pulumi and `force:false` | Worker and its namespace disappeared                  |
| Recreate the same Worker name and publish the same class/migration        | A different Worker ID and namespace ID were allocated |

The original namespace was absent after deletion and remained absent after
recreation. Therefore deleting every runtime Worker cannot also guarantee
retention of all environment data. `force:false` protects references; it does not
preserve a deleted Worker's own Durable Object namespace. No business data was
used in this test, and no claim of a successful data-preserving teardown is made.

## Required design correction

For a teardown that retains data, retain identities and namespace implementations
of Workers that host Durable Objects. Remove their public ingress, schedules,
queue consumption and outgoing application references, and publish a maintenance
implementation that preserves their classes and namespace identities. Keep these
Workers in their environment's Pulumi stack. A later release must reuse them.

Deleting these Workers and namespaces belongs exclusively to an explicit
data-deleting teardown. A future fixture must write synthetic Durable Object
data, retire the application with the hosts retained, release it again, and
verify both the same namespace IDs and the original values. This must be proven
alongside D1/R2/KV retention, dependency detachment, rollback and attachment
cleanup before any live runtime adoption.

The user approved this correction after the original probe. A subsequent isolated
cycle (`savia-iac-fixture-oct19b`) wrote synthetic values to a Durable Object, D1,
R2 and KV, retained the namespace host while removing other Workers, recreated the
application and verified the original namespace ID and all four original values.
It also verified a successful code update and an injected failed update followed
by restoration of actual deployed versions. All resources from that cycle were
cleaned up through Pulumi with `force:false`.

The complete compatibility gate additionally requires the integrated dynamic
resource and inert maintenance code. The integration probe exposed two runtime
issues that unit type-checking alone did not detect: Node's ESM loader requires
the explicit TypeScript extension, and Pulumi's serialized provider cannot retain
a module-level `Set` instance. Both now have verified corrections; the provider
serialization test evaluates the reconstructed provider, rather than checking its
source text alone. The corrected integrated lifecycle gate subsequently passed with
`savia-iac-fixture-oct19i`: actual dynamic-resource read-only adoption, unchanged
refresh, in-place digest-triggered publication, injected failed-update recovery,
and data-preserving retirement/recreation retained the same namespace ID and
synthetic DO/D1/R2/KV values. Cleanup removed all temporary resources and the
local stack. A separate cold installation (`savia-iac-fixture-oct19j`) also passed:
undeployed native identities received private placeholders before cyclic service
and cross-script Durable Object bindings were published. No production or Preview
release was performed.

These runs additionally caught native crypto closure serialization, TypeScript
class-field initialization overwriting Pulumi outputs, RPC object-key ordering,
and workers.dev propagation issues. Regression tests execute the reconstructed
provider and compiled resource, and retries remain bounded. An expired OAuth
session caused an earlier run to fail; it was renewed through existing Wrangler
custody and that run was fully cleaned before retrying. HTTP401 is never retried,
and HTTP429 honors the server's Retry-After header.

Opaque secrets require extra retention: unless recoverable external custody is
verified, their Worker identities remain in maintenance too. The fixture's sole
synthetic access key was held externally and explicitly checked before teardown.
Only secret-bearing Worker names enter the runtime inventory.

## Evidence custody

Cleanup completed through Pulumi with `force:false`. A subsequent Cloudflare
inventory found zero fixture Workers and zero fixture namespaces. The other 28
Worker identities and metadata were unchanged (reference-array order normalized),
and all 14 pre-existing account-wide Durable Object namespaces were unchanged.
The empty local fixture stack was removed after cleanup.

Command logs, encrypted local checkpoints and exact before/after namespace and
Worker metadata are private local operational evidence. They are excluded from
Git. Authentication was read at execution time from existing local custody;
credentials were neither added to the fixture inputs nor committed.
