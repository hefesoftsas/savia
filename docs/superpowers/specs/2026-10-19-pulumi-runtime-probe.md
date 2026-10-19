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

This correction changes the original assumption that every runtime identity can
be removed during a data-preserving teardown. The implementation plan remains at
its compatibility gate until the corrected behavior is agreed and proven.

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
