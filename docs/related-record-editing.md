# Related records in low-code forms

Owner: Savia platform · Reviewed: 2026-09-19

Local collection forms can create, link, edit and unlink related records while editing their parent. Parent data, related changes and links are submitted together. A failed validation or conflicting edit leaves the entire submission unchanged.

## Configure a field

1. Create a local relation between the two collections and bind it to a field in the parent collection.
2. In the form designer, select that field and open **Registros relacionados**.
3. Choose **Selector de registros**, **Subformulario**, or **Tabla editable**. Tables are available on the multiple side of a relation.
4. Choose visible child fields and the allowed create, edit, link and unlink actions. Required child fields remain visible. Define validation rules in the related collection.

Action settings restrict what this form may submit; they do not grant access beyond the authenticated user's collection permissions. External collection adapters retain their existing selector behavior.

Subforms expose child fields inside the parent editor. Tables show a bounded page of rows and open a child editor on demand. Changes stay in the parent form until its save succeeds. **Desvincular** removes the link and preserves the original related record.

## Drafts and synchronization

Authenticated local workspaces keep related-form drafts in IndexedDB, scoped by environment, user, API scope and permissions. Closing a form or a failed save preserves its draft. Reopening restores the original record versions and relation selections, so a concurrent server change produces a conflict rather than silently overwriting newer data. A successful submission clears the draft.

Submitting a related form requires a connection. Pending ordinary collection writes are synchronized first. Offline edits remain drafts; a related bundle is not split into independent offline writes. In contexts without a local workspace, edits remain in the open form and are not persisted across closing it. Storage failures are shown to the user.

The server requires an idempotency key, preventing a retry after a lost response from creating duplicate details. The draft preserves that key for retries. Automation delivery uses the rule definitions captured with the original commit; replaying a saved submission does not apply newly added or changed rules to that historical event. Reloading data after a conflict requires reviewing or discarding the stale draft; simply retrying does not bypass version checks.

## Current bounds

- One level of related editing, using local collections.
- Up to 10 relation groups and 100 related rows across one submission, including unchanged selected rows.
- Existing associations exceeding the supported size block the bundled editor; manage those links from the collection instead. The editor never silently truncates a saved selection.
- Child relation editing and attachment uploads remain in the related record's own editor. A required nested relation can prevent creating that child from the parent form.
- Unlinking never deletes a child. Record deletion remains a separate action.
- Public submission forms do not expose this authenticated bundle endpoint.

The authenticated collection gateway generates the bundle operation in its dynamic OpenAPI document. API schemas and reference pages are generated from code.
