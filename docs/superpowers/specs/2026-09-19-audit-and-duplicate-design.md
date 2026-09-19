# Permission audit browser and record duplication

## Intent

Continue bringing useful NocoBase-inspired operations into Savia after synchronizing main. This batch completes two existing workflows: inspecting access changes and creating a new record from an existing one. The user explicitly requested autonomous implementation through completion and push; intermediate design approval is not a separate gate for this batch.

## Permission audit

Add an Audit tab to the existing roles page. Read existing access_audit rows, never create a second audit store. Scope authorization matches role administration and is rechecked for every list/detail request. A bounded keyset-paginated list (25 default, 100 maximum) supports action, actor ID, target ID and UTC time-range filters. Cursor ordering is created_at DESC, id DESC and cursors bind to scope and filters. List responses contain summaries only; snapshots load on explicit selection through a separate detail request. Responses are no-store. UI queries are scope-specific, hide stale content on authorization errors and fetch only while the audit tab is mounted. Show actor, action, target, time and before/after differences with accessible loading, empty, error, retry and pagination states. Historical deleted actors retain their ID. No edit or deletion of history.

## Duplicate record

Expose a Duplicate action only for supported local records with read/create capability. Load the current visible source and open the existing create form prefilled with safe writable scalar values. Omit IDs, versions, ownership, timestamps, unique fields, readonly/formula fields, attachments and relations. Explicitly explain omitted fields. Saving uses the normal create flow, including IndexedDB and existing validation. Opening/cancelling the copy must not write or mutate the source. Existing URL navigation, full-page/dialog/drawer forms and create drafts must not mix source/copy IDs. Unsupported adapters remain excluded until their identity semantics are covered.

## Delivery

Preserve the incumbent UI and existing permissions. No new dependencies, tables or broad metadata refactor. Generated API definitions come from route schemas. Test authority boundaries, equal-time pagination, filter validation, lazy details, stale scope/error behavior, omission of unsafe fields, duplicate cancellation and independent create IDs. Update guides, review the diff, push main and verify CI/preview.
