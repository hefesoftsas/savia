# Record History Design

## Outcome

Users can inspect who changed a local record, when, and the previous/new values of selected fields. The feature is opt-in per collection, supports the existing offline write flow without duplicate history, and does not restore data in this iteration.

## Storage and capture

Capture deltas atomically with committed record changes, including ordinary CRUD, imports, workflows, sync retries, related-record bundles, cascade edits and schema publication. Do not use asynchronous event delivery for the authoritative history. Disabled collections produce no new history. Capture only configured supported scalar fields, never files, nested objects, relations or sensitive/system fields. Strings are capped at 2048 characters per side with explicit truncation flags; detect changes using the full source values. Record action, version, actor ID (null means unavailable/system), timestamp and selected field changes. Configuration bounds field count and retention to control cost. Never infer the acting user from record ownership.

## Read authorization

History is tenant and collection scoped. Check current record read access on every list/detail request and exclude fields absent from current metadata. Historical values cannot safely be exposed using permissions conditional on mutable field values without retaining full historical authorization snapshots. Fail closed for those grants: only grants independent of mutable values (all records or immutable creator predicates) can expose historical fields. Current record access alone does not widen those grants. Purged records are unavailable; soft-deleted records require read plus restore access. Use no-store responses and no IndexedDB history replication.

## Configuration and interface

Configuration is available to collection schema administrators: enable/disable tracking, select up to 50 eligible scalar fields, and set retention from 1 to 365 days (default 90). Validate names against current metadata, reject unsupported collections and stale object versions. Disabling stops capture while retained history remains readable until expiration. A record's lazy History tab lists 25 events at a time using keyset pagination; details load on demand. No total counts. Display explicit empty, loading, error, retry, redacted and unavailable-actor states. Clear prior data when identity/record changes or authorization fails. No backfill is implied: tracking begins when enabled.

## Cost and retention

Use indexed record/tenant pagination, bounded page sizes and detail payloads. Retention is fixed when an event is captured; changing the setting affects future events and never extends existing expiry. Query expiry is immediate; physical cleanup is bounded and eventually runs through the scheduled maintenance path. Hard collection/record deletion removes associated history. Do not add dependencies or Durable Objects.

## Verification

Regression tests cover transaction rollback, create/update/delete/restore, no-op changes, scalar false/zero/null, sensitive field exclusions, offline and bundle retries, tenant isolation, mutable predicate restrictions, changed field permissions, expiry, stale configuration, lazy requests and responsive UI. Run affected suites/types, independent review, integrate main and verify CI/preview.
