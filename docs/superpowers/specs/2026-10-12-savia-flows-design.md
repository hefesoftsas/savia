# Savia Flows

## Intent and authorization

Build a separate project in the Savia pnpm monorepo that provides the visual
editor and functional capabilities of Dafthunk, while using Savia identity,
tenant authorization, navigation and visual language. The user explicitly
authorized implementation without further approval on 2026-10-12. A source
snapshot or a small replacement workflow builder does not satisfy this request.

The user subsequently restricted the first version to local Miniflare services.
Do not deploy, provision Cloudflare resources, turn on remote bindings, connect
provider accounts or invoke billable external services without separate explicit
authorization. Public-repository source downloads and package installation are
development inputs, not enabled product services.

## Baseline and reuse

The functional baseline is `dafthunk-com/dafthunk` commit
`66be3083dc6c5349e150de5c9631477942399896`. Reuse the application, API,
runtime, node implementations, templates, migrations and tests from that
revision. Keep the MIT license and original copyright. Record the source
mapping and imported file hashes. Keep upstream agent instructions, deployment
accounts, credentials, marketing site and CI out of the Savia product.

The baseline has `apps/api`, `apps/app`, and `packages/{runtime,types,utils,geo}`.
Do not substitute the older README's `apps/web` layout. Reuse the actual
implementation rather than recreating the node catalog by hand.

## Architecture

Use `apps/flows` as the project root, with `api`, `app` and `packages/*` below
it, registered in the root pnpm workspace. Rename package references to
`@savia/flows-*` without changing the underlying runtime semantics.

The frontend is a separately built application. Its React Router version and
editor CSS remain isolated from the main admin application. The admin mounts
it in a same-origin frame under `/flows-ui/`, inside a `/savia-flows` page,
using the existing Savia shell. The embedded application uses a bounded
same-origin transport bridge to Savia's authenticated `ApiClient`; it must not
store or receive Savia bearer tokens. Every request includes the selected
tenant and is authorized by the host API. Standalone development uses the
same authenticated gateway, not an independent Dafthunk login system.

The API runs as `savia-flows`, a private Worker bound to the main Savia API.
It has its own database, R2 buckets, Workflows binding, Durable Objects and
optional runtime services. It does not share Studio workflow tables. Access
to its private routes requires a short-lived signed host context. Claims
identify the current principal, tenant organization and access role. A
request cannot create its own authority through `x-savia-*` headers.

## Functional scope

Preserve all node implementations and node categories from the pinned source,
including their schemas and outputs. Preserve graph construction, node/edge
editing, typed connections, layout and clipboard operations, parameter
editors, templates, validation, drafts/deployment, execution/rehearsal,
node-level status/results, history and realtime execution updates.

Preserve both direct Worker and durable Cloudflare Workflows runtime modes,
branching/parallel dataflow, asynchronous event waiting and multi-step nodes.
Preserve HTTP, schedule, queue, form, email and supported messaging triggers,
and integrations/OAuth, API keys, secrets, resource objects, datasets,
database/schema/queue/bot configuration, AI models and workflow generation.

Billing and standalone organization/user management are mapped to Savia's
tenant ownership and deployment policy. Do not silently invent unlimited
Cloudflare or vendor service capacity. The module exposes configuration and
clear failures for missing optional providers. Credentials and provider
entitlements remain external prerequisites, as they do in Dafthunk.

Record a machine-readable parity inventory from source. Each functional group
records its source, migrated location, external prerequisites and verification.
Completion requires the complete imported catalog and functioning
authoring/execution/resource surfaces, not only a matching file count.

## Identity and authorization

The main API derives the actor from existing authentication middleware.
Canonical organization ids are `tenant:<integer>`. Active tenant membership
is required; tenant administrators/owners and platform administrators may
author and manage resources. Other members may read and execute permitted
flows. API-key credentials must remain bounded by their tenant and scopes.
Unscoped platform access is explicit and requires platform administration.

The gateway signs context with a dedicated bridge secret, audience and
issuer, short expiry and an allowlisted role. The private API verifies it
before mapping the actor into upstream context and provisioning identity
mirrors. A principal's role is refreshed from host context on every request.
The application must not create independent login cookies, bypass revoked
membership, expose upstream administrative routes to a tenant, or treat a
query/header tenant as authority. Public triggers require their existing
per-resource authentication/signature/capability validation and separate
public gateway routes, never a fabricated authenticated actor.

## Savia UI

Retain the functional React Flow canvas and parameter widgets. Extend the
existing Savia visual world: theme tokens from
`apps/admin/src/styles/globals.css`, system typography, Emerald default,
light/dark/color-theme behavior, common button/input/card treatments, familiar
loading/error/empty states. Avoid a second global sidebar/header inside the
host shell. Module navigation remains local and preserves all functional
destinations. Brand visible surfaces as **Savia Flows** and retain Savia's
required legal attribution and third-party notices.

The default flow is workflow list → editor → run/deploy → execution details.
Context, tenant and unsaved changes are visible. Keyboard canvas editing,
focus, responsive panels and result inspection remain usable. Do not replace
working controls with decorative placeholders.

## Persistence and execution

Definitions, secrets and executions use the imported backend persistence.
Browser storage is not authoritative for business data or credentials.
Migration initialization is tested on a fresh local database. Runtime
changes must preserve upstream execution specifications. Managed execution
does not imply exactly-once external effects; retrying native Savia mutations
must use Savia's transactional/idempotent boundary. Existing Studio workflows
and Savia Request remain separate and are not migrated automatically.

The first runtime target is Miniflare: local D1, R2, KV, Workflows, queues and
Durable Objects. Use isolated task-specific persistence and local credentials.
Remote bindings are disabled. Enforce network denial at the local runtime
boundary, not only by omitting credentials. External node implementations remain
available for authoring, but execution returns an explicit unavailable-service
error. No mocked AI/provider output may be presented as a real result. Preserve
container definitions for Python/JS/shell, DuckDB and FFmpeg as future optional
adapters; do not activate cloud containers. Native/Docker/PostgreSQL support and
cloud deployment are outside this first version's execution scope.

## Verification and completion

1. Verify source provenance, license, package resolution, the complete node
   catalog and template/resource/trigger inventory.
2. Test gateway authentication, cross-tenant attempts, role changes, API-key
   scope, forged context, expiry and credential isolation.
3. Run imported runtime and application unit tests, appropriate typechecks,
   frontend production build and a strictly local Worker dry-run build.
4. Test fresh migrations and persisted CRUD/run/result/secret operations in
   an isolated local instance. Test durable recovery with local managed
   Workflows where supported.
5. Inspect the actual UI at desktop/mobile sizes and exercise a real save,
   reload, run and history path; record provider-dependent tests separately.
6. Run relevant existing Savia tests after host integration. Update the user
   guide, local setup and build instructions. Review the combined changes.

Do not mark the goal complete while any required authoring/execution surface
is missing, checks fail, or independent-login/raw-source behavior remains.
