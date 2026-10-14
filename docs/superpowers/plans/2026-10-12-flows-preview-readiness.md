# Flows Preview Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track completion below.

**Goal:** Prepare a complete, locally verified Flows preview release without provisioning or activating services.

**Architecture:** Centralized Pulumi outputs own deployment manifests and explicit provision/execute switches. Atomic admission and bounded runtime work enforce shared preview quotas; restricted outbound networking blocks providers. Versioned multi-resource backups and an ordered deployment pipeline preserve recovery capability.

**Tech Stack:** TypeScript, D1, R2, Cloudflare Workers/Workflows, QuickJS, Miniflare, Pulumi, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-12-flows-preview-readiness.md`

## Global Constraints

- No cloud activation, remote mutation or preview pipeline dispatch.
- Keep provisioning and execution false by default.
- Run large local checks serially with one worker.
- Preserve existing edits and unrelated recovery documents.
- Code, tests and docs in English.

## Review Focus

- Concurrent admissions and retry IDs cannot bypass shared quotas.
- Stored definitions and code tool calls cannot bypass denied egress.
- Pausing retains resources and blocks both native and graph execution.
- Backups include every enabled bucket and DO database and reject mismatched restore targets.
- Disabled Flows neither requires new secrets nor adds pipeline mutations.

## Tasks

- [x] Implement atomic admission, pause and runtime node/step bounds with targeted tests (quota worker).
- [x] Implement versioned multi-resource backups and validated restore with targeted tests (backup worker).
- [x] Add runtime egress enforcement and DO snapshot/recovery support with local tests (root).
- [x] Integrate Flows source onto current main with centralized infrastructure; preserve independent edits (root).
- [x] Add explicit execution settings, conditional secret validation, migrations, backup ordering and deploy verification to pipeline (root).
- [x] Review combined changes, run serial relevant suites/typechecks/builds and record evidence (root/reviewer).
- [x] Leave a concrete reviewable branch with both switches disabled; report checks and remaining operational constraints.

Evidence: [preview readiness verification](../../verification/2026-10-12-flows-preview-readiness.md).

## Rulings

- User authorization supersedes skill approval checkpoints; continue without confirmation.
- Reuse the existing IaC worktree for integration; do not modify main or dispatch deployment.
- Shared admission uses atomic D1 persistence, avoiding another infrastructure resource or non-atomic KV increments.
