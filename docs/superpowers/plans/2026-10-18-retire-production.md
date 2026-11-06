# Production Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Savia production application and its data while keeping preview operational.

**Architecture:** Pulumi owns the production D1/R2 stack. Adopt the separately Wrangler-published production Workers and host attachments into a narrowly scoped Pulumi retirement stack, review its plan, then destroy those resources before emptying and destroying production persistence. Preview and the independent shared plugin registry remain isolated and preserved.

**Tech Stack:** Pulumi, Cloudflare Workers/D1/R2, GitHub Actions, Node.js.

**Spec:** User explicitly requested production retirement and separately confirmed permanent deletion of all production data on October 18, 2026 (America/Bogota).

## Global Constraints

- Preserve all preview resources, branch previews, their state backend, and the shared plugin registry.
- Never infer application environment from Cloudflare's `production` Worker version label; preview Workers use that label too.
- Production application Workers are exactly `savia`, `savia-agencies`, `savia-auth`, `savia-backup-coordinator`, `savia-connectors`, `savia-domain-transition`, `savia-hook-executor`, `savia-mcp`, and `savia-request`.
- Remove host attachments for `savia.hefesoft.com`, `savia.app.hefesoft.com`, and the old tenant hostname, plus the production root/wildcard bridge routes.
- Permanent data deletion includes the two adopted production D1 UUIDs, `savia-documents`, production Durable Object namespaces, `savia-production-backups`, and the production Pulumi backend only after confirming it contains no shared or preview state.
- Do not reopen the canceled Cloudflare support investigation or clear individual orphaned permits; the entire production coordinator is being retired.
- No credentials or business data in committed audit records.

## Tasks

- [x] Export the production Pulumi state and inventory live resource identities; compare preview bindings.
- [x] Disable production deployment/backup workflows and close the obsolete canonical-hostname PR.
- [x] Adopt production Workers/routes/custom domains into a bounded Pulumi retirement stack without republishing code; review its preview.
- [x] Destroy production ingress, Workers, and their production-only Durable Object storage with Pulumi.
- [x] Empty production R2 contents, remove deletion protection from the exact production data resources, and destroy the production data stack; handle its backend last.
- [x] Remove active production deployment workflows/configuration, restrict infrastructure dispatch to preview, and mark historical runbooks as retired.
- [x] Verify production endpoints no longer serve Savia; verify preview health, login, shared registry and its infrastructure identities.
- [x] Review focused tests and infrastructure diffs and record exact completion evidence and provider limitations.
- [ ] Publish and integrate the repository cleanup after required CI checks.
