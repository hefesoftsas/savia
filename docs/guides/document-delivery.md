# Documents and deliveries

Saved record attachments support **Save copy in OneDrive** and **Send with Outlook**, alongside the existing Office editor. The record's Documents tab groups attachments; the delivery dialog shows the current saved revision, the connected personal account, and recent delivery history.

## Workflow

1. Attach a document to a saved record. Use Edit for supported DOCX, XLSX or PPTX files and save the Office revision before sending it.
2. Choose Save copy, select the personal or business OneDrive connection, browse a destination folder, and choose a name. This creates a separate copy; subsequent edits in either system do not synchronize.
3. Alternatively choose Send, enter recipients, subject, and message. The saved file is attached to a message from the current user's Outlook connection.
4. Review the destination, file and version, then confirm. Preparing the review makes no external write. Outlook success means Microsoft accepted the submission, not that recipients have received it.
5. Review delivery history in the dialog. It persists provider, actor ID, saved file version, time and outcome. It does not retain email bodies, recipients, tokens or attachment bytes.

Long filenames wrap inside the delivery dialog; file details, destination inputs and actions stay within its width. The local preview supports `?long-name` for checking this layout.

## Boundaries

- The current tenant, record read/export policy and attachment field grants are checked for every request, including confirmation. Each connection belongs to the authenticated user.
- A confirmation is encrypted, principal-bound, tenant/file/version-bound and expires after five minutes. Changing the connected account or saved version requires a new review.
- An atomic claim in the existing `studio_requests` backend table prevents repeated or simultaneous execution of the same confirmation. Claims and metadata survive reloads; no browser storage is used. Delivery rows use a dedicated key prefix, separate from record-create idempotency keys.
- OneDrive copies are limited to 5 MiB. Outlook attachments are limited to 2 MiB. Provider permissions, quotas and filename restrictions still apply. There is no automatic overwrite of an existing OneDrive item.
- A network failure can leave the external result unknown. Such a confirmation is consumed, and its history remains unknown. Check Outlook Sent Items or the OneDrive folder before explicitly preparing another attempt. There is no automatic retry of external writes.
- A history refresh failure does not change a confirmed delivery outcome. The dialog preserves the confirmation and offers **Refresh history**, which repeats only the read request and never sends the document again.
- History is limited to the latest 50 entries per file. Tenant members with the required export access can see this metadata. Document delivery emits realtime invalidation hints without message contents.
- Requires the existing personal integration Nango configuration and personal action payload cipher. Missing/revoked connections are resolved through Connections. No new database migration is needed.
- Templates, automatic data population, shared editing, incoming Outlook attachment import, PDF generation and bidirectional synchronization are outside this first version.

## Verification

Provider tests validate binary uploads, attachment encoding, ownership and limits with mocked Microsoft responses. Studio integration tests run against local D1/R2 and cover permission checks, stale versions, connection changes, expiry, duplicate confirmations, unknown outcomes and private history. These tests do not send real messages or create files in a Microsoft account.

Folder browsing follows up to ten Microsoft pages (100 items per page) and fails explicitly if the directory exceeds that bound, rather than silently hiding later folders. Sharing a OneDrive copy with other people is not part of this operation.

## OneDrive Personal proxy routing

Savia uses Microsoft Graph paths for OneDrive operations. Nango's `one-drive-personal` provider defaults to `api.onedrive.com`, so the server pins its proxy destination to `https://graph.microsoft.com` with `Base-Url-Override`. The destination is fixed in server code and is never supplied by the browser. Without this override, a valid Graph-authorized connection can return HTTP 401 while loading folders. This applies to folder reads, file search and saved copies using that personal connection; other providers retain their configured destination.

History reads use an indexed literal key range instead of LIKE, so UUID file identifiers fit D1 query limits and identifiers are never interpreted as wildcard patterns.
