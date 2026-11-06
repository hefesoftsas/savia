# Core Localization Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution.

**Goal:** Localize built-in core screens and make missing coverage visible in CI.

**Architecture:** Extend the existing locale context with typed module dictionaries.
Keep formatting pure and locale-aware; preserve machine values and user content.

**Tech Stack:** React, TypeScript, react-admin/Polyglot, Vitest, TypeScript AST.

**Spec:** `docs/superpowers/specs/2026-09-19-core-localization-design.md`

## Global constraints

- ES, EN, PT only; Spanish remains the default.
- No new dependencies, persistence layer, or changes to business data.
- Existing independent worktrees remain untouched.

## Review focus

- Switching locale must update mounted components without losing form edits.
- Literal user content matching a dictionary key must remain unchanged.
- Number/date display must not change serialized values or currency codes.
- Interpolation arguments must be escaped by React, never interpreted as HTML.
- Missing entries and new untranslated UI must fail scoped coverage checks.

## Tasks

- [x] Add locale-aware translation primitives and tests for switching, interpolation,
      unsupported locale fallback, and user-content preservation.
- [x] Extract system copy from core permissions and low-code controls into typed
      dictionaries; localize JSX text, attributes, conditional labels, and notifications.
- [x] Thread the selected locale through value formatting, booleans and dates;
      verify EN/PT results with fixed date/number inputs.
- [x] Add dictionary and source coverage tests to the existing admin CI lane;
      prove they detect untranslated source and missing interpolation variables.
- [x] Run focused tests, admin suite and typecheck; record limitations and update
      `docs/localization.md` with the exact coverage contract.
