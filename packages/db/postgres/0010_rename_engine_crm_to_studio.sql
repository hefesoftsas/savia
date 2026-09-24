-- Fase 3 (postgres): rename low-code engine tables crm_* -> studio_*.
-- Native counterpart of the SQLite rename migration. External HubSpot
-- sync tables keep their names. Trigger functions keep their names;
-- only bodies referencing renamed tables are replaced.
DROP TRIGGER IF EXISTS crm_history_insert ON crm_records;
DROP TRIGGER IF EXISTS crm_history_update ON crm_records;
DROP TRIGGER IF EXISTS crm_history_delete ON crm_records;
DROP TRIGGER IF EXISTS crm_record_links_cardinality ON crm_record_links;
DROP TRIGGER IF EXISTS crm_record_links_storage ON crm_record_links;
DROP TRIGGER IF EXISTS crm_relation_definition_update ON crm_collection_relations;
DROP VIEW IF EXISTS crm_record_history_fields;
ALTER TABLE crm_objects RENAME TO studio_objects;
ALTER TABLE crm_records RENAME TO studio_records;
ALTER TABLE crm_views RENAME TO studio_views;
ALTER TABLE crm_audit RENAME TO studio_audit;
ALTER TABLE crm_files RENAME TO studio_files;
ALTER TABLE crm_file_drafts RENAME TO studio_file_drafts;
ALTER TABLE crm_file_revisions RENAME TO studio_file_revisions;
ALTER TABLE crm_notes RENAME TO studio_notes;
ALTER TABLE crm_tasks RENAME TO studio_tasks;
ALTER TABLE crm_data_domains RENAME TO studio_data_domains;
ALTER TABLE crm_automations RENAME TO studio_automations;
ALTER TABLE crm_automation_runs RENAME TO studio_automation_runs;
ALTER TABLE crm_business_links RENAME TO studio_business_links;
ALTER TABLE crm_collection_versions RENAME TO studio_collection_versions;
ALTER TABLE crm_collection_sources RENAME TO studio_collection_sources;
ALTER TABLE crm_collection_relations RENAME TO studio_collection_relations;
ALTER TABLE crm_record_links RENAME TO studio_record_links;
ALTER TABLE crm_record_history RENAME TO studio_record_history;
ALTER TABLE crm_record_history_context RENAME TO studio_record_history_context;
ALTER TABLE crm_schema_versions RENAME TO studio_schema_versions;
ALTER TABLE crm_schema_data RENAME TO studio_schema_data;
ALTER TABLE crm_studio_settings RENAME TO studio_settings;
ALTER TABLE crm_unique_values RENAME TO studio_unique_values;
ALTER TABLE crm_write_guards RENAME TO studio_write_guards;
ALTER TABLE crm_solution_installations RENAME TO studio_solution_installations;
ALTER TABLE crm_solution_objects RENAME TO studio_solution_objects;
ALTER TABLE crm_extension_installations RENAME TO studio_extension_installations;
ALTER TABLE crm_geocoding_settings RENAME TO studio_geocoding_settings;
ALTER TABLE crm_native_relation_overrides RENAME TO studio_native_relation_overrides;
ALTER TABLE crm_access_deliveries RENAME TO studio_access_deliveries;
ALTER TABLE crm_requests RENAME TO studio_requests;
ALTER TABLE crm_collection_requests RENAME TO studio_collection_requests;
ALTER TABLE crm_integrations RENAME TO studio_integrations;
ALTER TABLE crm_integration_runs RENAME TO studio_integration_runs;
ALTER INDEX crm_records_object RENAME TO studio_records_object;
ALTER INDEX crm_records_active RENAME TO studio_records_active;
ALTER INDEX crm_files_record RENAME TO studio_files_record;
ALTER INDEX crm_files_record_field RENAME TO studio_files_record_field;
ALTER INDEX crm_file_drafts_expiry RENAME TO studio_file_drafts_expiry;
ALTER INDEX crm_notes_record RENAME TO studio_notes_record;
ALTER INDEX crm_tasks_due RENAME TO studio_tasks_due;
ALTER INDEX crm_integrations_owner_index RENAME TO studio_integrations_owner_index;
ALTER INDEX crm_integration_runs_history RENAME TO studio_integration_runs_history;
ALTER INDEX crm_integration_runs_idempotency RENAME TO studio_integration_runs_idempotency;
ALTER INDEX crm_record_history_expiry RENAME TO studio_record_history_expiry;
ALTER INDEX crm_unique_record RENAME TO studio_unique_record;
ALTER INDEX crm_record_links_incoming RENAME TO studio_record_links_incoming;
CREATE OR REPLACE FUNCTION crm_history_write_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = savia_core, pg_catalog AS $$
DECLARE changes jsonb := '{}'::jsonb; f record; before_value jsonb; after_value jsonb;
 retention integer; changed boolean := false; action text; at_time timestamptz := clock_timestamp();
BEGIN
 FOR f IN SELECT * FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name LOOP
  retention := f.retention_days;
  before_value := CASE WHEN TG_OP='UPDATE' THEN OLD.data::jsonb -> f.field_name ELSE NULL END;
  after_value := NEW.data::jsonb -> f.field_name;
  IF (TG_OP='INSERT' OR before_value IS DISTINCT FROM after_value)
    AND (jsonb_typeof(before_value) IN ('null','string','number','boolean') OR jsonb_typeof(after_value) IN ('null','string','number','boolean')) THEN
   changes := changes || jsonb_build_object(f.field_name, savia_history_value('before',before_value)||savia_history_value('after',after_value));
   changed := true;
  END IF;
 END LOOP;
 IF retention IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN action := 'created';
 ELSE
  IF NOT changed AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN RETURN NEW; END IF;
  action := CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restored' ELSE 'updated' END;
 END IF;
 INSERT INTO studio_record_history(tenant_id,object_name,record_id,version,action,created_at,actor_kind,actor_id,cause_id,changes,expires_at)
 VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.version,action,to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 COALESCE((SELECT actor_kind FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),'system'),
 (SELECT actor_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT cause_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),changes::text,
 to_char((at_time + retention * interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION crm_history_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = savia_core, pg_catalog AS $$
BEGIN DELETE FROM studio_record_history WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name AND record_id=OLD.id; RETURN OLD; END $$;
CREATE OR REPLACE FUNCTION crm_record_links_cardinality_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = savia_core, pg_catalog AS $trigger$
BEGIN
-- Serialize link guards with competing links and definition UPDATE row locks.
-- The separate check statement receives a fresh READ COMMITTED snapshot after waiting.
PERFORM 1 FROM studio_collection_relations
 WHERE tenant_id=NEW.tenant_id AND id=NEW.relation_id FOR UPDATE;
IF EXISTS (
 SELECT 1 FROM studio_collection_relations r JOIN studio_record_links e ON e.tenant_id=r.tenant_id AND e.relation_id=r.id
 WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.relation_id
 AND ((r.cardinality='one-to-one' AND e.source_id=NEW.source_id AND e.target_id<>NEW.target_id)
 OR (r.cardinality IN ('one-to-one','one-to-many') AND e.target_id=NEW.target_id AND e.source_id<>NEW.source_id))
 ) THEN RAISE EXCEPTION 'relation_cardinality_conflict'; END IF;
RETURN NEW;
END $trigger$;
CREATE OR REPLACE FUNCTION crm_record_links_storage_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = savia_core, pg_catalog AS $trigger$
BEGIN
-- Serialize link guards with competing links and definition UPDATE row locks.
-- The separate check statement receives a fresh READ COMMITTED snapshot after waiting.
PERFORM 1 FROM studio_collection_relations
 WHERE tenant_id=NEW.tenant_id AND id=NEW.relation_id FOR UPDATE;
IF EXISTS(SELECT 1 FROM studio_collection_relations WHERE tenant_id=NEW.tenant_id AND id=NEW.relation_id AND storage<>'local') THEN RAISE EXCEPTION 'relation_mapping_has_links'; END IF;
RETURN NEW;
END $trigger$;
CREATE OR REPLACE FUNCTION crm_relation_definition_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = savia_core, pg_catalog AS $trigger$
BEGIN
IF (NEW.source_field<>OLD.source_field OR NEW.target_field<>OLD.target_field OR NEW.storage<>OLD.storage) AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id) THEN RAISE EXCEPTION 'relation_mapping_has_links'; END IF;
 IF (NEW.cardinality='one-to-one' AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id GROUP BY source_id HAVING count(*)>1)) OR (NEW.cardinality IN ('one-to-one','one-to-many') AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id GROUP BY target_id HAVING count(*)>1)) THEN RAISE EXCEPTION 'relation_cardinality_conflict'; END IF;
RETURN NEW;
END $trigger$;
CREATE OR REPLACE FUNCTION notification_record_event_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = savia_core, pg_catalog AS $$
DECLARE
  v_operation text;
  v_event_key text;
  v_event_id text;
  v_actor_kind text;
  v_actor_id text;
  v_payload text;
  v_created_at bigint;
  v_tenant text;
  v_object text;
  v_record text;
  v_title text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tenant := NEW.tenant_id; v_object := NEW.object_name; v_record := NEW.id;
    v_operation := 'created';
    v_event_key := 'record:' || v_tenant || ':' || v_object || ':' || v_record || ':' || NEW.version;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.data IS NOT DISTINCT FROM NEW.data
      AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
      RETURN NEW;
    END IF;
    v_tenant := NEW.tenant_id; v_object := NEW.object_name; v_record := NEW.id;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_operation := 'deleted';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_operation := 'created';
    ELSE
      v_operation := 'updated';
    END IF;
    v_event_key := 'record:' || v_tenant || ':' || v_object || ':' || v_record || ':' || NEW.version;
  ELSE
    v_tenant := OLD.tenant_id; v_object := OLD.object_name; v_record := OLD.id;
    v_operation := 'deleted';
    v_event_key := 'record:' || v_tenant || ':' || v_object || ':' || v_record || ':purged';
  END IF;
  v_title := v_object || ' ' || v_operation;
  IF v_operation = 'created' AND TG_OP = 'UPDATE' THEN
    v_title := v_object || ' restored';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM notification_subscriptions
    WHERE workspace_id = v_tenant AND collection = v_object
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  SELECT actor_kind, actor_id INTO v_actor_kind, v_actor_id
  FROM studio_record_history_context WHERE tenant_id = v_tenant LIMIT 1;
  v_actor_kind := COALESCE(v_actor_kind, 'system');
  v_event_id := 'ntf_' || md5(random()::text || clock_timestamp()::text || v_event_key);
  v_created_at := (extract(epoch FROM now()) * 1000)::bigint;
  v_payload := jsonb_build_object(
    'scope', jsonb_build_object('kind', 'workspace', 'id', v_tenant),
    'key', v_event_key,
    'actor', jsonb_build_object('kind', v_actor_kind, 'id', v_actor_id),
    'source', jsonb_build_object('kind', 'record', 'collection', v_object, 'id', v_record, 'operation', v_operation),
    'title', v_title,
    'body', '',
    'audience', jsonb_build_object('kind', 'collection-followers', 'collection', v_object),
    'createdAt', v_created_at,
    'expiresAt', NULL
  )::text;
  INSERT INTO notification_events(id, scope_kind, scope_id, event_key, payload, created_at)
  VALUES (v_event_id, 'workspace', v_tenant, v_event_key, v_payload, v_created_at);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE VIEW studio_record_history_fields AS
SELECT o.tenant_id, o.name AS object_name, f.key AS field_name,
 LEAST(365,GREATEST(1,CASE WHEN o.config::jsonb #>> '{studio,history,retentionDays}' IS NULL THEN 90 WHEN o.config::jsonb #> '{studio,history,retentionDays}'='true'::jsonb THEN 1 ELSE COALESCE(substring(o.config::jsonb #>> '{studio,history,retentionDays}' from '^[[:space:]]*([+-]?[0-9]+)'), '0')::numeric END))::integer AS retention_days
FROM studio_objects o
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(o.config::jsonb -> 'fields')='object' THEN o.config::jsonb -> 'fields' ELSE '{}'::jsonb END) f
WHERE o.config::jsonb #> '{studio,history,enabled}' IN ('true'::jsonb,'1'::jsonb)
 AND o.config::jsonb #> '{studio,collection}' IS NULL
 AND COALESCE(o.config::jsonb #>> '{studio,business}','') NOT IN ('managed-customer','managed-agency')
 AND jsonb_typeof(o.config::jsonb #> '{studio,history,fields}')='array'
 AND f.key IN (SELECT value #>> '{}' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.config::jsonb #> '{studio,history,fields}')='array' THEN o.config::jsonb #> '{studio,history,fields}' ELSE '[]'::jsonb END) WITH ORDINALITY AS chosen(value,ordinality) WHERE jsonb_typeof(value)='string' AND ordinality<=50)
 AND f.key !~ '[^A-Za-z0-9_]' AND left(f.key,1)<>'_'
 AND f.key NOT IN ('id','created_at','updated_at','deleted_at','created_by','updated_by','createdAt','updatedAt','deletedAt','createdBy','updatedBy','constructor','prototype')
 AND f.value ->> 'type' IN ('Textbox','Textarea','Email','Phone','Url','Address','Number','Currency','Dropdown','Autocomplete','Toggle','DateControl')
 AND COALESCE(f.value -> 'hidden','0'::jsonb) IN ('0'::jsonb,'false'::jsonb,'null'::jsonb)
 AND COALESCE(f.value -> 'readOnly','0'::jsonb) IN ('0'::jsonb,'false'::jsonb,'null'::jsonb)
 AND COALESCE(f.value #> '{config,sensitive}','0'::jsonb) IN ('0'::jsonb,'false'::jsonb,'null'::jsonb)
 AND COALESCE(f.value #> '{config,readable}','1'::jsonb) NOT IN ('0'::jsonb,'false'::jsonb)
 AND COALESCE(f.value -> 'readable','1'::jsonb) NOT IN ('0'::jsonb,'false'::jsonb)
 AND COALESCE(f.value #> '{config,multiple}','0'::jsonb) IN ('0'::jsonb,'false'::jsonb,'null'::jsonb)
 AND (f.value #> '{config,formula}' IS NULL OR f.value #> '{config,formula}'='null'::jsonb)
 AND (f.value #> '{config,relation}' IS NULL OR f.value #> '{config,relation}'='null'::jsonb)
 AND (f.value #> '{config,collectionRelation}' IS NULL OR f.value #> '{config,collectionRelation}'='null'::jsonb)
 AND (f.value #> '{config,collectionRelationTarget}' IS NULL OR f.value #> '{config,collectionRelationTarget}'='null'::jsonb);
CREATE TRIGGER studio_history_insert AFTER INSERT ON studio_records FOR EACH ROW EXECUTE FUNCTION crm_history_write_fn();
CREATE TRIGGER studio_history_update AFTER UPDATE ON studio_records FOR EACH ROW EXECUTE FUNCTION crm_history_write_fn();
CREATE TRIGGER studio_history_delete AFTER DELETE ON studio_records FOR EACH ROW EXECUTE FUNCTION crm_history_delete_fn();
CREATE TRIGGER studio_record_links_cardinality BEFORE INSERT ON studio_record_links FOR EACH ROW EXECUTE FUNCTION crm_record_links_cardinality_fn();
CREATE TRIGGER studio_record_links_storage BEFORE INSERT ON studio_record_links FOR EACH ROW EXECUTE FUNCTION crm_record_links_storage_fn();
CREATE TRIGGER studio_relation_definition_update BEFORE UPDATE ON studio_collection_relations FOR EACH ROW EXECUTE FUNCTION crm_relation_definition_update_fn();
