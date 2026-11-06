# Plugin web extensions implementation plan

**Goal:** Add a real VS Code API runtime and two verified web extensions to the plugin IDE.

**Architecture:** Isolate VS Code services in a bundled iframe editor. Keep authoring and persistence in the parent and existing backend API.

**Spec:** `docs/superpowers/specs/2026-10-10-plugin-web-extensions-design.md`

## Tasks

- [x] Add validated per-project extension settings and paired database migrations; test unknown IDs and save/load behavior.
- [x] Bundle an isolated VS Code editor entry with retained models, filesystem synchronization, checked parent messages, theme, read-only state, and navigation.
- [x] Register reviewed formatter and snippet extensions through the VS Code API; test lifecycle and formatting.
- [x] Add the localized extension panel and bridge it to backend project settings, existing tabs/search and archived source edits.
- [x] Update the plugin development guide, run focused checks and production build, and review combined changes.
- [ ] Create PR, merge through normal CI, and verify deployment in preview.

## Review focus

Do not let document switches drop undo or pending edits. Reject messages from other frames or unknown paths. Do not save editor preferences in browser storage. Keep compiled archive entry separate from original files. Extensions must honor read-only state and dispose providers when disabled. Do not load arbitrary extension code or imply Node runtime support.
