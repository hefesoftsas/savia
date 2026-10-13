# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Savia Flows provides Dafthunk's visual workflow authoring and execution
capabilities as a separate project in the Savia monorepo. The user requires
functional reuse and a Savia interface, rather than a source-only copy.

## Capabilities and Constraints

The baseline is Dafthunk commit 66be3083dc6c5349e150de5c9631477942399896.
First-version execution uses local Miniflare services only. External/billable
services must not be enabled without explicit user authorization. Their nodes
remain authorable and clearly report unavailable execution dependencies.

## Brand Commitments

The product name is Savia Flows. Inherit Savia's existing theme, navigation,
identity, tenant authorization and legal attribution. Preserve MIT attribution
for reused Dafthunk code.

## Evidence on Hand

The complete imported editor, API, runtime and shared packages are recorded in
UPSTREAM.json. Savia's visual authority is apps/admin/src/styles/globals.css
and the existing admin components. No provider credentials are part of this
project.

## Assumptions

The primary users are existing authenticated Savia tenant members and
administrators, inferred from the host platform and the integration request.
The default destination is workflow authoring, rather than upstream SaaS
onboarding or billing.
