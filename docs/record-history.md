# Record change history

Savia can retain field-level change history for local collections. Open a collection's record list and choose **Configurar historial**, enable tracking, choose the fields and save. This is available to schema administrators, including when the collection has no records. Saving requires connectivity and checks the current collection version; reload configuration after a concurrent change.

Tracking is disabled by default. Choose up to 50 supported scalar fields and a retention period from 1 to 365 days (90 by default). Files, nested values, relationships, system fields, hidden, readonly, sensitive and formula fields are excluded. Deselect a tracked field before removing it or changing it to an unsupported type. External database and CRM adapters and managed business collections do not expose this feature.

## Inspect a record

Open a record and choose **Historial**. Events show their committed version, time, action and actor identifier. **Ver cambios** loads the selected event's previous and new values. Missing sides, nulls, booleans and zero remain distinct. Updates to untracked fields and semantic no-ops do not create events, so version gaps are normal. Delete and restore events can have no field changes because the action itself describes the change.

Each page contains at most 25 summaries. The history component loads on demand, and values are requested only when expanded. **Actualizar historial** returns to the newest page. History requires connectivity and is not replicated to IndexedDB. Opening another record/workspace resets its state; failed authorization hides the previously loaded history.

Tracking starts when enabled. Existing changes are not backfilled. Selective field restoration is available from an expanded event. Trash restoration remains a separate operation and is recorded when tracking is enabled.

## Authorization and attribution

Every history request checks current record access and current field metadata. Soft-deleted records additionally require restore access. Purged records are unavailable. Values of removed or newly sensitive fields are not returned.

Permissions conditional on mutable field values cannot safely authorize past values using today's record. Such grants do not grant historical field access. General read grants and predicates based solely on the immutable creator can authorize history; historical field visibility is restricted to their matching fields. If no such grant applies, history returns a permission error. This prevents an assignment or status change from exposing past values belonging to a different access scope.

User attribution comes from the authenticated write, not the record owner. Workflow events identify the workflow owner and execution; anonymous form events identify the public form. Direct writes without authenticated context are marked **Sistema / Autor no disponible**. Identifiers remain useful after an actor is removed; this UI does not resolve display names across scopes.

## Capture and cost

D1 triggers capture selected deltas in the same transaction as committed changes. Ordinary CRUD, bulk changes, imports, workflows, public forms, offline pushes, related-record bundles and schema migrations use this capture. Failed transactions leave no history. Retried offline and bundle operations reuse their existing receipts and do not capture another event. Schema migrations use the field selection active before publication.

Strings are stored up to 2048 characters per side, explicitly marked as truncated. Full source values are compared to detect changes even beyond the stored prefix. At most 50 selected fields and bounded text keep one history entry below the size of two unrestricted records. This is an inspection trail, not a backup of complete documents.

Retention is fixed when an event is captured. Changing the duration applies to future events and never extends existing expiry. Disabling tracking stops new capture while existing events remain readable until their original expiry. Reads hide expired entries immediately. Scheduled maintenance physically deletes at most 500 expired entries per invocation using an expiry index, including history from idle or disabled collections; physical cleanup may lag if expiration volume exceeds that batch. Hard deletion of a record also deletes its history.

Capture adds one history row for each relevant committed record version, plus two temporary actor-context writes per transactional batch. No Durable Objects or additional polling connections are introduced. The operational domain audit (`studio_audit`) has a separate lifecycle: the existing API scheduled tick retains the 200 most recent events for each `domain:*` scope by `created_at`, breaking timestamp ties by descending `id`, and deletes older events. The domain audit endpoint returns up to those 200 events. Cleanup runs once per minute in preview, production and the self-hosted runtime, so a domain can briefly exceed the limit between ticks. Agency operational audit, collection record history and access-control audit retention are unchanged.

## Deployment

Apply API migration `0057_record_history.sql` and standalone CRM migration `0017_record_history.sql` before serving the new application code. They add the history table, expiry index, selected-field view, transaction actor context and capture/purge triggers. The production API's existing scheduled maintenance performs bounded cleanup; standalone CRM operators must invoke the exported maintenance function on their own schedule. Do not remove these tables while serving code that supplies actor context.

## Restore selected fields

Choose **Restaurar campos** on an expanded event. The comparison loads the current server record and its version. Choose before/after values and explicitly select fields, then confirm. Missing or truncated values cannot be restored. Relationships, files and other unsupported fields remain excluded. This restores values from a single captured delta, not a complete historical snapshot.

The server checks historical read permissions and current update permissions again, validates the result against the current schema and constraints, and commits through the ordinary record update operation. Source retention, schema version and record version are guarded in the transaction. Concurrent edits require a fresh comparison. The operational audit records the source version, side and selected fields. Capture records the resulting edit when history is enabled.

Recovery requires connectivity. Pending local mutations or related-record bundles block it until synchronized or resolved. After a successful write, a forced collection refresh updates IndexedDB before the detail queries refresh. If that refresh loses connectivity, the server write remains successful and normal synchronization retries the refresh. Existing version checks prevent a retry from overwriting intervening changes; uncertain network responses require reviewing the current record.

## Inspect usage and cleanup lag

From collection history settings choose **Consultar consumo del historial**. This administrator-only, tenant-scoped measurement reports event count, UTF-8 bytes of the change payload and expired events awaiting deletion. The query examines at most 1,000 events; larger collections show explicit lower bounds and a sample-local oldest expiration. It runs only on request. These bytes exclude row metadata, indexes and other D1 storage, so they are not billing estimates or exact tenant storage totals.

Scheduled cleanup emits a structured `record_history_cleanup` report with deleted rows, oldest remaining expired timestamp and lag in seconds. The post-cleanup probe uses the expiration index and reads one row, rather than counting the full backlog. Sustained lag indicates that the bounded 500-row cleanup cannot keep pace and needs operational attention. This release adds observability, not automatic deletion of unexpired data or notification delivery.
