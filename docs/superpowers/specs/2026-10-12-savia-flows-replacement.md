# Savia Flows replacement

## Outcome and constraints

Savia Flows must replace the original Studio workflow interface while retaining
every implemented workflow capability. The user authorized implementation without
approval checkpoints and clarified that existing data is disposable test data.
Use local Miniflare only; activate no external or billable service. Retain the
Dafthunk editor/runtime and Savia appearance already implemented.

## Runtime choice

Adopt the existing transactional engine as the native execution mode of Flows.
Move its implementation into `apps/flows/packages/native` rather than rebuilding
its transaction, scheduler, task and webhook guarantees inside arbitrary graph
nodes. Core hosts that mode because its record writes, receipts, notifications
and execution checkpoints must share the same database transaction. Existing
Studio import paths become compatibility exports. API clients and public webhook
URLs remain compatible. There must be one transactional scheduler, never a copied
engine concurrently processing the same definitions.

The new Flows catalog and visual graph editor expose native flows as well as
Dafthunk flows. Native graph connections compile to the established validated
definition (`next`, condition `otherwise`, first entrypoint). Positions are optional
backend-owned definition metadata. Reuse the current typed property controls,
trigger controls, webhook configuration, history, retry/cancel, task inbox and
bundle preparation in the new module. Retire the sequence editor entry point.

The native mode retains manual and scheduled starts; collection lifecycle events
and all/any trigger filters; typed references, concatenation and calendar offsets;
condition, transform, equality query, unique matched create, update, assigned task,
internal notification, relative/absolute durable delay and outgoing webhook.
Published immutable revisions, owner checks, failed-step retry, cancellation,
ingress receipts and egress attempt history keep their existing semantics.

Adoption reads the original canonical backend records in place. It does not copy
definitions, start executions, alter webhook secrets, or drop retained history.
This is a zero-copy migration with compatibility API names, not two active native
engines. Existing pending runs continue through the relocated runtime.

## Private host adapter

Flows API exposes tenant-scoped `/savia/native/*` routes through its existing
authenticated parent bridge. A private Core adapter accepts a strictly allowlisted
method/path/body envelope with a body-bound, ten-second HS256 token, issuer
`savia-flows`, audience `savia-flows-native-host`, subject principal and tenant.
Reload active principal, tenant and current workflow permissions for every call.
Public callers cannot select a principal or reach this adapter. Delegate to the
same native route handlers and contributor registry as compatibility clients.
Schema and migration inventory reads are manager-scoped. No secrets appear in
ordinary read responses; once-only webhook secret responses stay no-store.

An optional subsequent Run Savia Flow node could compose a published manual
native flow into a Dafthunk graph, with deterministic start idempotency and the
parent execution principal. It is outside this replacement increment: Studio
did not implement subflows, and parity is provided by the adopted native mode.

## Coexistence and retirement

Carry causation across native and Dafthunk writes so mixed collection-trigger
chains cannot reset recursion depth. Studio navigation links to Flows, preserving
tenant selection. Keep compatibility HTTP APIs and database objects needed by
notifications and existing clients; removing those would break implemented
capabilities. Document the retained adapters explicitly.

## Verification

Cover actual backend adoption, immutable publish/edit behavior, connection and
layout round trips, all native node types, trigger operators, inbox resolution,
manual retry, cancellation, schedule owner authority, incoming duplicate/conflict
handling, outgoing delivery against an injected local transport, crash recovery,
tenant isolation, and fresh revocation checks. Run original native suites against
the relocated implementation, focused new API/UI tests, local Miniflare bridge
tests, type checks, builds, source verification and scoped formatting. Visually
inspect the new native graph in local Chrome. No production migration or external
delivery is claimed.
