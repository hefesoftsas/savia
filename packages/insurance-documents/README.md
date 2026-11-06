# @savia/insurance-documents

Optional independently installed insurance operations plugin.

See [the operations guide](../../docs/insurance-operations.md) for supported
workflows, validation boundaries and source release packaging.

Run `pnpm --filter @savia/insurance-documents test` and
`pnpm extension:pack insurance-documents`.

## Validity and reopening

`valid_until` makes approved documents overdue after the last valid day. The saved-record action reopens an expired approval for correction with a new due date, preserving receipt evidence and review history. It reads the latest version and performs a version-checked update. Native attachments are managed by the shared saved-record attachment panel.
