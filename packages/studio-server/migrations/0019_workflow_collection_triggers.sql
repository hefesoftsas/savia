-- Collection event filters are evaluated atomically against the captured snapshot.
-- Existing published definitions without conditions keep their original behavior.
DROP TRIGGER IF EXISTS workflow_record_created;
DROP TRIGGER IF EXISTS workflow_record_updated;
DROP TRIGGER IF EXISTS workflow_event_dispatch;
CREATE TRIGGER workflow_record_created AFTER INSERT ON crm_records
 WHEN NEW.deleted_at IS NULL AND EXISTS (
 SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.tenant_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type') IN ('created','created_or_updated')
 AND json_extract(v.definition,'$.trigger.collection')=NEW.object_name)
 BEGIN
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT NEW.tenant_id,NEW.object_name,'created','{}',
 json_set(NEW.data,'$.id',NEW.id,'$._version',NEW.version,'$.created_at',NEW.created_at,'$.updated_at',NEW.updated_at),
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) LEFT JOIN workflow_write_context c ON c.workspace_id=NEW.tenant_id AND c.record_id=NEW.id;
END;
CREATE TRIGGER workflow_record_updated AFTER UPDATE OF data ON crm_records
 WHEN NEW.deleted_at IS NULL AND OLD.deleted_at IS NULL AND NEW.data<>OLD.data AND EXISTS (
 SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.tenant_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type') IN ('updated','created_or_updated')
 AND json_extract(v.definition,'$.trigger.collection')=NEW.object_name)
 BEGIN
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT NEW.tenant_id,NEW.object_name,'updated',
 json_set(OLD.data,'$.id',OLD.id,'$._version',OLD.version,'$.created_at',OLD.created_at,'$.updated_at',OLD.updated_at),
 json_set(NEW.data,'$.id',NEW.id,'$._version',NEW.version,'$.created_at',NEW.created_at,'$.updated_at',NEW.updated_at),
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) LEFT JOIN workflow_write_context c ON c.workspace_id=NEW.tenant_id AND c.record_id=NEW.id;
END;
CREATE TRIGGER workflow_record_deleted AFTER UPDATE OF deleted_at ON crm_records
 WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
 SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=OLD.tenant_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type')='deleted'
 AND json_extract(v.definition,'$.trigger.collection')=OLD.object_name)
 BEGIN
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT OLD.tenant_id,OLD.object_name,'deleted',
 json_set(OLD.data,'$.id',OLD.id,'$._version',OLD.version,'$.created_at',OLD.created_at,'$.updated_at',OLD.updated_at),'{}',
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) LEFT JOIN workflow_write_context c ON c.workspace_id=OLD.tenant_id AND c.record_id=OLD.id;
END;
CREATE TRIGGER workflow_record_hard_deleted AFTER DELETE ON crm_records
 WHEN OLD.deleted_at IS NULL AND EXISTS (
 SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=OLD.tenant_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type')='deleted'
 AND json_extract(v.definition,'$.trigger.collection')=OLD.object_name)
 BEGIN
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT OLD.tenant_id,OLD.object_name,'deleted',
 json_set(OLD.data,'$.id',OLD.id,'$._version',OLD.version,'$.created_at',OLD.created_at,'$.updated_at',OLD.updated_at),'{}',
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) LEFT JOIN workflow_write_context c ON c.workspace_id=OLD.tenant_id AND c.record_id=OLD.id;
END;
CREATE TRIGGER workflow_event_dispatch AFTER INSERT ON workflow_events WHEN NEW.depth<5 BEGIN
 INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,node_id,context,depth)
 SELECT w.workspace_id,v.id||':'||NEW.id,w.id,v.id,v.owner_id,v.owner_id,'event:'||NEW.id,
 json_extract(v.definition,'$.nodes[0].id'),
 json_object('trigger',json(CASE WHEN NEW.kind='deleted' THEN NEW.before_state ELSE NEW.after_state END),
 'before',json(NEW.before_state),'steps',json('{}'),
 'system',json_object('owner',v.owner_id,'workspace',w.workspace_id,'event',NEW.id,'eventType',NEW.kind,'cause',NEW.cause)),NEW.depth
 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.workspace_id AND w.enabled=1
 AND (json_extract(v.definition,'$.trigger.type')=NEW.kind OR
 (json_extract(v.definition,'$.trigger.type')='created_or_updated' AND NEW.kind IN ('created','updated')))
 AND json_extract(v.definition,'$.trigger.collection')=NEW.collection
 AND (NEW.kind<>'updated' OR COALESCE(json_array_length(v.definition,'$.trigger.changedFields'),0)=0 OR EXISTS (
 SELECT 1 FROM json_each(v.definition,'$.trigger.changedFields') f
 WHERE json_extract(NEW.before_state,'$.'||f.value) IS NOT json_extract(NEW.after_state,'$.'||f.value)
 OR json_type(NEW.before_state,'$.'||f.value) IS NOT json_type(NEW.after_state,'$.'||f.value)))
 AND (COALESCE(json_array_length(v.definition,'$.trigger.conditions'),0)=0 OR (
 SELECT CASE WHEN json_extract(v.definition,'$.trigger.conditionMode')='any' THEN MAX(matched) ELSE MIN(matched) END
 FROM (
 SELECT COALESCE(CASE operator
 WHEN 'eq' THEN actual_type IS NOT NULL AND (actual_type=expected_type OR (actual_type IN ('integer','real') AND expected_type IN ('integer','real'))) AND actual IS expected
 WHEN 'neq' THEN actual_type IS NOT NULL AND NOT ((actual_type=expected_type OR (actual_type IN ('integer','real') AND expected_type IN ('integer','real'))) AND actual IS expected)
 WHEN 'gt' THEN actual_type IN ('integer','real') AND actual>expected
 WHEN 'gte' THEN actual_type IN ('integer','real') AND actual>=expected
 WHEN 'lt' THEN actual_type IN ('integer','real') AND actual<expected
 WHEN 'lte' THEN actual_type IN ('integer','real') AND actual<=expected
 WHEN 'contains' THEN actual_type='text' AND instr(actual,expected)>0
 WHEN 'empty' THEN actual_type IS NULL OR actual_type='null' OR (actual_type='text' AND actual='')
 WHEN 'not_empty' THEN actual_type IS NOT NULL AND actual_type<>'null' AND NOT (actual_type='text' AND actual='')
 ELSE 0 END,0) AS matched
 FROM (
 SELECT json_extract(f.value,'$.operator') AS operator,
 json_extract(f.value,'$.value') AS expected,json_type(f.value,'$.value') AS expected_type,
 json_extract(CASE WHEN NEW.kind='deleted' THEN NEW.before_state ELSE NEW.after_state END,'$.'||json_extract(f.value,'$.field')) AS actual,
 json_type(CASE WHEN NEW.kind='deleted' THEN NEW.before_state ELSE NEW.after_state END,'$.'||json_extract(f.value,'$.field')) AS actual_type
 FROM json_each(v.definition,'$.trigger.conditions') f
 ))));
END;
