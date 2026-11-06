# Recording Conversations Implementation Plan

**Goal:** Replace recording Q&A consent forms with the existing assistant, with owner-private conversations synchronized across devices.

**Approved design:** Notes and transcript beside the assistant on desktop, stacked on mobile. One conversation per recording/session, available in the general assistant history. Remove routine processing consent checks. Preserve ambiguous retry acknowledgement. The user explicitly requires server persistence.

**Architecture:** D1 stores assistant threads with revision checks. The chat endpoint resolves recording references against the authenticated owner's Companion storage and passes reference material separately from instructions. Embedded and general assistant share the existing runtime and conversation components and the same API history. No new model integration.

**Global constraints:** Preserve tenant/owner access, shared themes and ES/EN/PT translations. Never silently overwrite concurrent edits or claim a failed save succeeded. Keep previous browser history available for migration. No deployment in this task.

## Tasks

- [x] Backend: add migration, owner-scoped thread CRUD and optimistic revision checks; resolve recording/session context for the existing chat endpoint. Test ownership, stale writes, source context and synchronization through fresh reads.
- [x] Shared assistant: API client and remote history hook, explicit loading/save failure states, reuse the existing runtime and persist messages before sending and on completion. Test reopen from another client and failed saves.
- [x] Recording surface: replace old Q&A forms, remove routine acceptance checks, desktop/mobile layout using incumbent tokens. Update interaction tests.
- [x] Integration: update guide, run focused admin/API tests and typechecks, inspect desktop/mobile and review changes.

## Review focus

- Concurrent devices must receive a conflict instead of losing messages.
- Account changes must not reuse another user's history.
- Context from another owner or tenant must not enter a request.
- Failed provider requests must retain the user's saved question.
- Switching recordings must not attach the previous recording's context.

## Verification

- Admin assistant and Companion suites: 13 files, 85 tests passed.
- API assistant/Companion focused suites: 5 files, 46 tests passed; the final thread suite passed all 8 tests after adding the server-context route regression.
- API source typecheck passes. Admin typecheck is blocked by missing pre-existing react-day-picker and Plate dependencies; changed assistant/Companion files have no diagnostics.
- Desktop (1440 px), mobile (390 px), and dark desktop preview inspected with synthetic data: no JavaScript errors or horizontal overflow. Impeccable finish review: ship.
- Independent review found unsaved draft loss on panel close; regression observed failing, fixed, and verified passing. Reviewer scored the fix resolved.
- Changed frontend files pass formatting; git diff --check is clean.
- Deployment and migration application were not performed. Apply 0032_assistant_threads.sql with the normal release.
