# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Authenticated workspace users and administrators operating data-driven applications
across many domains. Platform administrators manage shared configuration.

## Product Purpose

Savia is a general-purpose low-code platform for collections, screens, forms,
integrations, workflows, and assisted work. Insurance and CRM integrations are
optional solutions; they do not define the platform's core user or data model.

## Positioning

Configure an application around its data and processes. Keep authorization and
execution state in the backend, with inspectable results and explicit changes.

## Operating Context

Users work in a configurable administrative interface on desktop and mobile.
Each data domain or workspace isolates its collections and configuration.
Solution-specific screens retain their specialized behavior and terminology.

## Capabilities and Constraints

- Collections, relations, screens and forms are configured through metadata.
- General workflows support native collections, immutable published versions,
  durable executions and per-step results. External workflow actions are deferred.
- Credentials remain on the server; the assistant prepares changes for confirmation.
- The application is installable as a PWA. Workflow management requires a server
  connection; it adds no browser-persistence fallback.
- Insurer retry and issuance restrictions remain specific to that solution.

## Brand Commitments

Preserve the established administrative UI: direct operational language,
configurable themes, shared React Admin/shadcn components and clear states.

## Evidence on Hand

Records and results come from Savia APIs. Identify test data explicitly;
do not fabricate successful integrations or execution.

## Product Principles

- Make changes and execution state inspectable.
- Keep data and permissions scoped to the authorized workspace.
- Separate editable drafts from published behavior.
- Present failures and recovery actions clearly.
- Keep industry assumptions inside optional solutions.

## Accessibility & Inclusion

Support keyboard navigation, visible focus and responsive desktop/mobile layouts.
