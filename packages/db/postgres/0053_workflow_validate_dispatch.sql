-- Pre-save validation flows reject forbidden states synchronously in the
-- services layer and run their steps asynchronously when the write passes.
-- Record triggers must capture events for validate flows, and the dispatch
-- function starts their executions only when the gate conditions do NOT
-- match (passing writes).
CREATE OR REPLACE FUNCTION savia_core.workflow_record_write_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
DECLARE event_kind text := CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END;
BEGIN
 IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (OLD.deleted_at IS NOT NULL OR NEW.data=OLD.data) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.tenant_id AND w.enabled=1 AND v.definition::jsonb #>> '{trigger,type}' IN (event_kind,'created_or_updated','validate') AND v.definition::jsonb #>> '{trigger,collection}'=NEW.object_name) THEN RETURN NEW; END IF;
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT NEW.tenant_id,NEW.object_name,event_kind,
 CASE WHEN TG_OP='INSERT' THEN '{}' ELSE (OLD.data::jsonb || jsonb_build_object('id',OLD.id,'_version',OLD.version,'created_at',OLD.created_at,'updated_at',OLD.updated_at))::text END,
 (NEW.data::jsonb || jsonb_build_object('id',NEW.id,'_version',NEW.version,'created_at',NEW.created_at,'updated_at',NEW.updated_at))::text,
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) dummy LEFT JOIN workflow_write_context c ON c.workspace_id=NEW.tenant_id AND c.record_id=NEW.id;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION savia_core.workflow_event_dispatch_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
 IF NEW.depth<5 THEN
 INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,node_id,context,depth)
 SELECT w.workspace_id,v.id||':'||NEW.id,w.id,v.id,v.owner_id,v.owner_id,'event:'||NEW.id,v.definition::jsonb #>> '{nodes,0,id}',
 jsonb_build_object('trigger',CASE WHEN NEW.kind='deleted' THEN NEW.before_state::jsonb ELSE NEW.after_state::jsonb END,'before',NEW.before_state::jsonb,'steps','{}'::jsonb,
 'system',jsonb_build_object('owner',v.owner_id,'workspace',w.workspace_id,'event',NEW.id,'eventType',NEW.kind,'cause',NEW.cause))::text,NEW.depth
 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.workspace_id AND w.enabled=1
 AND (v.definition::jsonb #>> '{trigger,type}'=NEW.kind OR (v.definition::jsonb #>> '{trigger,type}'='created_or_updated' AND NEW.kind IN ('created','updated')))
 AND v.definition::jsonb #>> '{trigger,collection}'=NEW.collection
 AND (NEW.kind<>'updated' OR COALESCE(jsonb_array_length(v.definition::jsonb #> '{trigger,changedFields}'),0)=0 OR EXISTS (
 SELECT 1 FROM jsonb_array_elements_text(v.definition::jsonb #> '{trigger,changedFields}') f(value)
 WHERE NEW.before_state::jsonb -> f.value IS DISTINCT FROM NEW.after_state::jsonb -> f.value
 OR savia_workflow_json_type(NEW.before_state::json -> f.value) IS DISTINCT FROM savia_workflow_json_type(NEW.after_state::json -> f.value)))
 AND (COALESCE(jsonb_array_length(v.definition::jsonb #> '{trigger,conditions}'),0)=0 OR (
 SELECT CASE WHEN v.definition::jsonb #>> '{trigger,conditionMode}'='any' THEN bool_or(savia_workflow_condition((CASE WHEN NEW.kind='deleted' THEN NEW.before_state::jsonb ELSE NEW.after_state::jsonb END) -> (f.value->>'field'),f.value)) ELSE bool_and(savia_workflow_condition((CASE WHEN NEW.kind='deleted' THEN NEW.before_state::jsonb ELSE NEW.after_state::jsonb END) -> (f.value->>'field'),f.value)) END
 FROM jsonb_array_elements(v.definition::jsonb #> '{trigger,conditions}') f(value)));
 INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,node_id,context,depth)
 SELECT w.workspace_id,v.id||':'||NEW.id,w.id,v.id,v.owner_id,v.owner_id,'event:'||NEW.id,v.definition::jsonb #>> '{nodes,0,id}',
 jsonb_build_object('trigger',NEW.after_state::jsonb,'before',NEW.before_state::jsonb,'steps','{}'::jsonb,
 'system',jsonb_build_object('owner',v.owner_id,'workspace',w.workspace_id,'event',NEW.id,'eventType',NEW.kind,'cause',NEW.cause))::text,NEW.depth
 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.workspace_id AND w.enabled=1
 AND v.definition::jsonb #>> '{trigger,type}'='validate'
 AND NEW.kind IN ('created','updated')
 AND v.definition::jsonb #>> '{trigger,collection}'=NEW.collection
 AND (NEW.kind<>'updated' OR COALESCE(jsonb_array_length(v.definition::jsonb #> '{trigger,changedFields}'),0)=0 OR EXISTS (
 SELECT 1 FROM jsonb_array_elements_text(v.definition::jsonb #> '{trigger,changedFields}') f(value)
 WHERE NEW.before_state::jsonb -> f.value IS DISTINCT FROM NEW.after_state::jsonb -> f.value
 OR savia_workflow_json_type(NEW.before_state::json -> f.value) IS DISTINCT FROM savia_workflow_json_type(NEW.after_state::json -> f.value)))
 AND NOT (COALESCE(jsonb_array_length(v.definition::jsonb #> '{trigger,conditions}'),0)=0 OR (
 SELECT CASE WHEN v.definition::jsonb #>> '{trigger,conditionMode}'='any' THEN bool_or(savia_workflow_condition(NEW.after_state::jsonb -> (f.value->>'field'),f.value)) ELSE bool_and(savia_workflow_condition(NEW.after_state::jsonb -> (f.value->>'field'),f.value)) END
 FROM jsonb_array_elements(v.definition::jsonb #> '{trigger,conditions}') f(value)));
 END IF;
 RETURN NEW;
END $$;
