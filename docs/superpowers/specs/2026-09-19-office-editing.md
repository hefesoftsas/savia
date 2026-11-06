# Direct Office editing
User-approved scope: integrate the successful ZetaOffice spike into Savia.
Single-user DOCX/XLSX/PPTX editing from existing R2 attachments. No macros, coediting, browser document persistence or production deployment.
A separate /office/ document uses COOP/COEP without changing admin authentication pages. Same-origin session cookies authorize the existing dynamic CRM/data-domain API. The URL contains only an allowlisted API base and file ID.
Immutable revision blobs in R2, version compare-and-swap and revision metadata/audit in one D1 transaction. The original is retained on first edit. Concurrent saves return 409; failed saves retain the draft in memory and allow a local recovery download.
File metadata and version-specific content reads validate tenant, active record, object and attachment field. Saves revalidate file type, bounded ZIP structure, size and field policy. Existing API wrappers enforce manager/platform authorization.
Runtime resources are pinned by SHA-256 and served through a restricted R2 asset handler in production; local development reads an ignored cache. Large WASM/data files never enter the frontend build or PWA precache.
UI: filename, revision, save status, Save, Download copy, history with downloadable revisions, and return to Savia. Error/timeout states, unsaved-change guard, keyboard save, and loading feedback.
Verification: real local D1/R2 integration tests for round trips, stale/concurrent writes, failures and tenant isolation; UI state tests; runtime header/routing tests; browser editing against persisted test data. No claim of full Microsoft Office fidelity.
