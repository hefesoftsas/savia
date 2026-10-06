# Plugin Studio

Mode: Operate. This surface replaces the embedded store authoring form with a
workspace for writing, reviewing and running a Savia plugin. It extends the shared
Savia theme; it does not change the surrounding Studio/CRM design system.

The first viewport opens code, an expandable file explorer and an assistant
conversation together. The user's work fills the available area. Project actions
sit in a compact toolbar; save state belongs in the bottom status bar. No outer
card, page hero or separate explanatory heading competes with the editor.

Desktop uses Allotment's adjustable panes. The explorer is narrow, code receives
remaining space, and the assistant has enough width to read responses and review
changed files. Below 850px of available workspace width, Files, Code, Preview and
Chat expose one area at a time. Pane switches preserve mounted editors and preview.

The assistant reads as a conversation: user request, pending state, assistant
answer, proposed files and apply/discard. The composer stays at the bottom and
supports Enter to send and Shift+Enter for new lines. Proposed files open an inline
Monaco diff; no generated code is applied silently.

Monaco is bundled from npm (never a CDN) so the editor boots offline from the
app shell. The `entry.tsx` editor additionally offers ghost-text inline
completions (monacopilot) served by the tenant-scoped
`POST /api/assistant/plugin-completion` route: short, import-free continuations
from the workspace's configured model, best-effort and silent on failure.
Completion traffic carries no provider keys; the API key stays server-side
like the chat authoring route.

The assistant streams over SSE (`POST /api/assistant/plugin-authoring/stream`):
message deltas render live, a `usage` event reports input/output tokens (shown
as ↑/↓ beside the pending indicator and under the finished answer; usage is
client-side only and never persisted to the project), and the validated files
arrive as a final `result` event. Pre-stream failures (auth, configuration,
collection metadata) keep regular JSON error responses; mid-stream failures
arrive as `error` events. While a generation runs, the composer stays enabled
and further prompts join a visible capped queue that drains in order after
each successful generation; cancel stops only the running request.

Tokens derive from the active Savia palette:

- Canvas/ink: `--background`, `--foreground`.
- Dividers: foreground mixed at 13% against background (`--ide-line`).
- Secondary surface: foreground mixed at 4% (`--ide-soft`).
- Secondary text: foreground mixed at 68% (`--ide-secondary`).
- Selection/action/focus: `--primary`, `--ring`; errors: `--destructive`.
- Typeface: inherited `--font-sans`; code: Monaco's inherited monospace font.
- Dense labels: 11–12px; body and editor: 13px; welcome title: 16px.
- Panel titles/tabs: 38px; mobile navigation and file rows: 44px.

Selection uses restrained tint and a tab rule. Plain copy uses neutral foreground
rather than the primary accent. Light/dark changes update editors and preview
without discarding the code, conversation or running plugin state.
