-- Preserve native execution IDs in record history while sharing workflow ancestry.
DROP TRIGGER savia_flows_collection_events_insert;
--> statement-breakpoint
DROP TRIGGER savia_flows_collection_events_update;
--> statement-breakpoint
CREATE TRIGGER savia_flows_collection_events_insert
AFTER INSERT ON studio_records
WHEN EXISTS (
  SELECT 1 FROM studio_record_history_context
  WHERE tenant_id=NEW.tenant_id AND actor_id IS NOT NULL AND length(trim(actor_id))>0
)
AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO savia_flows_collection_event_outbox(
    id, tenant_id, collection_name, operation, record_id, record_version,
    occurred_at, before_snapshot, after_snapshot, changed_fields,
    actor_kind, actor_id, cause_id, created_at
  )
  SELECT 'sfe_'||lower(hex(randomblob(16))), NEW.tenant_id, NEW.object_name,
    'created', NEW.id, NEW.version, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL,
    json_patch(NEW.data, json_object(
      'id',NEW.id,'_version',NEW.version,'created_at',NEW.created_at,
      'updated_at',NEW.updated_at,'deleted_at',NEW.deleted_at,'created_by',NEW.created_by
    )),
    COALESCE((SELECT json_group_array(key) FROM json_each(NEW.data)), '[]'),
    (SELECT actor_kind FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
    (SELECT actor_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
    COALESCE((SELECT cause FROM workflow_write_context WHERE workspace_id=NEW.tenant_id AND record_id=NEW.id),
      (SELECT cause_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id)),
    CAST(strftime('%s','now') AS INTEGER)*1000;
END;
--> statement-breakpoint
CREATE TRIGGER savia_flows_collection_events_update
AFTER UPDATE ON studio_records
WHEN EXISTS (
  SELECT 1 FROM studio_record_history_context
  WHERE tenant_id=NEW.tenant_id AND actor_id IS NOT NULL AND length(trim(actor_id))>0
)
AND (
  OLD.deleted_at IS NOT NEW.deleted_at
  OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL AND OLD.data IS NOT NEW.data)
)
AND NOT EXISTS (
  SELECT 1 FROM studio_schema_data archived
  JOIN studio_objects current_schema
    ON current_schema.tenant_id=archived.tenant_id
   AND current_schema.name=archived.object_name
  WHERE archived.tenant_id=NEW.tenant_id
    AND archived.object_name=NEW.object_name
    AND archived.record_id=NEW.id
    AND archived.version=current_schema.version
)
BEGIN
  INSERT INTO savia_flows_collection_event_outbox(
    id, tenant_id, collection_name, operation, record_id, record_version,
    occurred_at, before_snapshot, after_snapshot, changed_fields,
    actor_kind, actor_id, cause_id, created_at
  )
  SELECT 'sfe_'||lower(hex(randomblob(16))), NEW.tenant_id, NEW.object_name,
    CASE
      WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted'
      WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restored'
      ELSE 'updated'
    END,
    NEW.id, NEW.version, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    json_patch(OLD.data, json_object(
      'id',OLD.id,'_version',OLD.version,'created_at',OLD.created_at,
      'updated_at',OLD.updated_at,'deleted_at',OLD.deleted_at,'created_by',OLD.created_by
    )),
    json_patch(NEW.data, json_object(
      'id',NEW.id,'_version',NEW.version,'created_at',NEW.created_at,
      'updated_at',NEW.updated_at,'deleted_at',NEW.deleted_at,'created_by',NEW.created_by
    )),
    COALESCE((
      SELECT json_group_array(field) FROM (
        SELECT key AS field FROM json_each(OLD.data)
        UNION
        SELECT key AS field FROM json_each(NEW.data)
      ) WHERE json_extract(OLD.data,'$.'||field) IS NOT json_extract(NEW.data,'$.'||field)
        OR json_type(OLD.data,'$.'||field) IS NOT json_type(NEW.data,'$.'||field)
    ),'[]'),
    (SELECT actor_kind FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
    (SELECT actor_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
    COALESCE((SELECT cause FROM workflow_write_context WHERE workspace_id=NEW.tenant_id AND record_id=NEW.id),
      (SELECT cause_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id)),
    CAST(strftime('%s','now') AS INTEGER)*1000;
END;
