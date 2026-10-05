# Direct WhatsApp Assistant Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded tasks and report to the coordinator.

**Goal:** Connect Meta inbound messages directly to a tenant's Savia virtual employee.

**Architecture:** A signed public webhook writes a durable D1 inbox. A fenced
processor generates restricted employee replies and sends through Nango. An
explicit tenant binding controls the employee and allowed contacts.

**Tech Stack:** Hono, Cloudflare Workers/D1, existing minute cron, AI SDK, Nango.

**Spec:** `docs/superpowers/specs/2026-10-05-whatsapp-direct-assistant.md`

## Global Constraints

- Tenant isolation, no global routing fallback, no customer administrative tools.
- English code/docs; no deployment secrets or private phone numbers in source.
- Preserve the current webhook until the replacement has been verified.

## Review Focus

- Duplicate events and concurrent processors must result in one send.
- Revoked memberships or changed bindings must prevent a pending reply.
- Ambiguous shared senders must not choose a tenant implicitly.
- Outbound timeouts must not cause blind retries.
- Delivery receipts must not regress an already read/delivered message.

## Tasks

- [x] Persistence: migrations (SQLite/PostgreSQL), core schema and manifest;
      `whatsapp/inbound-contracts.ts`, `inbound-repository.ts`, `inbound-processor.ts`;
      meaningful database tests for routing, deduplication, leases and retries.
- [x] Public webhook: `whatsapp/webhook.ts` plus tests for verification, HMAC,
      malformed payloads, incoming text and delivery receipts.
- [x] Restricted AI adapter and sender: `whatsapp/assistant.ts`, tests for explicit
      tenant configuration, active employee, employee knowledge and no tools.
- [x] Integration: runtime fetch/scheduler, authenticated binding configuration,
      WhatsApp settings UI and behavior tests, runbook.
- [ ] Review combined changes; run focused suites, typecheck and relevant schema
      contracts. Prepare PR, verify preview, configure secrets and pilot, then move
      callback only when verified.
