# Native WhatsApp Capabilities Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded components and report to the coordinator.

**Goal:** Add native WhatsApp interaction and media capabilities with tenant isolation and an optional insurance intake contribution.

**Architecture:** Validated native replies and tenant resource configuration extend the existing durable inbox. Nango sends Graph payloads; incoming native events become scoped conversational context. Optional insurance questionnaire definitions remain in the insurance plugin.

**Tech Stack:** Hono, Zod, Cloudflare Workers/D1/R2, AI SDK, Nango.

**Spec:** `docs/superpowers/specs/2026-10-05-whatsapp-native-capabilities.md`

## Constraints and review focus

- No customer administrative tools, arbitrary resource URLs or insurer calls.
- No credentials or pilot phone numbers in committed source.
- Preserve existing text behavior and terminal uncertain-send semantics.
- Media must enforce host, size and checksum bounds before AI processing.
- Buttons and submissions do not authorize actions; tenant/contact checks remain mandatory.
- Published Flow/catalog/template prerequisites must be visible to administrators.

## Tasks

- [x] Native message contracts and Graph payload builder: create `whatsapp/native.ts` and meaningful payload/resource-boundary tests before implementation.
- [x] Media transport: bounded Nango metadata/download/upload helpers, private tenant R2 handling and media security tests.
- [x] Durable native input/reply integration: migrate settings and inbox payloads, parse native webhook events, process typed replies and status indicators; test replays/isolation/revocation.
- [x] Tenant settings and native management endpoints: resource discovery, configuration and native sending; provide admin UI and behavior tests.
- [x] Optional insurance contribution: identify existing plugin, add light-vehicle intake/Flow artifact and tested validation; expose through release catalog without core industry imports.
- [ ] Review combined code, run focused tests/typecheck/schema contracts, update runbooks, create PR and verify deployment when GitHub runners recover.

Implementation and independent review are complete. Required CI, merge and live preview verification remain the release gate. No provider calls or Meta asset publishing were performed during verification.
