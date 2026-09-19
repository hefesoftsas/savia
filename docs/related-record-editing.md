# Related records in low-code forms

Owner: Savia platform · Reviewed: 2026-09-19

Local collection forms can create, link, edit and unlink related records while editing their parent. Parent data, related changes and links are submitted together. A failed validation or conflicting edit leaves the entire submission unchanged.

## Configure a field

1. Create a local relation between the two collections and bind it to a field in the parent collection.
2. In the form designer, select that field and open **Registros relacionados**.
3. Choose **Selector de registros**, **Subformulario**, or **Tabla editable**. Tables are available on the multiple side of a relation.
4. Choose visible child fields and the allowed create, edit, link and unlink actions. Required child fields remain visible. Define validation rules in the related collection.

Action settings restrict what this form may submit; they do not grant access beyond the authenticated user's collection permissions. Scoped roles must have the corresponding parent and child record grants and permission to write each bound relation field. The server enforces row filters, projects readable fields and guards the permission revision inside the atomic transaction. Scoped local link reads are supported; standalone scoped link writes remain disabled. External collection adapters retain their existing selector behavior.

Subforms expose child fields inside the parent editor. Tables show a bounded page of rows and open a child editor on demand. Changes stay in the parent form until its save succeeds. **Desvincular** removes the link and preserves the original related record.

## Drafts and synchronization

Authenticated local workspaces keep related-form drafts in IndexedDB, scoped by environment, user, API scope and permissions. Closing a form or a failed save preserves its draft. Reopening restores the original record versions and relation selections, so a concurrent server change produces a conflict rather than silently overwriting newer data. A successful submission clears the draft.

Saving a prepared related form in a local workspace commits the parent, details, links and one outbox operation in a single IndexedDB transaction. The form closes immediately with a device-save confirmation; records remain marked pending until the server acknowledges the complete bundle. A failed local transaction preserves the draft. Collections, relation definitions and existing links must be downloaded before offline editing; unknown links are never treated as an empty selection. In contexts without a local workspace, submission still requires connectivity.

On reconnection, Web Locks serialize bundle synchronization with ordinary writes. Stable client record IDs and the original idempotency key prevent a lost response from creating duplicate details. A record already owned by another pending operation cannot enter a second bundle. The server validates the complete request and applies its records, links and receipt atomically. Automation replay uses the rule definitions captured by the original commit.

The synchronization panel resolves a rejected or conflicting form as one unit: accept current server records, or explicitly reapply local values using freshly downloaded versions and complete links. Reapplying creates a new operation key; automatic network retries retain the original key. Missing or deleted records cannot be silently resurrected. Resolution requires connectivity. Permission changes quarantine pending payloads and remove their recovery/export controls. Expired authentication hides local data while preserving uncertain operations for the same account and unchanged policy.

## Current bounds

- One level of related editing, using local collections.
- Up to 10 relation groups and 100 related rows across one submission, including unchanged selected rows.
- Existing associations exceeding the supported size block the bundled editor; manage those links from the collection instead. The editor never silently truncates a saved selection.
- Child relation editing and attachment uploads remain in the related record's own editor. A required nested relation can prevent creating that child from the parent form.
- Unlinking never deletes a child. Record deletion remains a separate action.
- Public submission forms do not expose this authenticated bundle endpoint.

The authenticated collection gateway generates the bundle operation in its dynamic OpenAPI document. API schemas and reference pages are generated from code.
