-- Fase 3: rename low-code engine tables crm_* -> studio_*.
-- External HubSpot sync tables (crm_connections, crm_sync_*, ...)
-- intentionally keep their names. Old migrations are immutable.
-- this file is the single rename step, applied once per database.
PRAGMA defer_foreign_keys = ON;

--> statement-breakpoint
DROP TRIGGER IF EXISTS crm_record_links_cardinality;
--> statement-breakpoint
DROP TRIGGER IF EXISTS crm_relation_definition_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS crm_record_links_storage;
--> statement-breakpoint
DROP TRIGGER IF EXISTS crm_history_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS crm_history_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS crm_history_delete;
--> statement-breakpoint
ALTER TABLE crm_objects RENAME TO studio_objects;
--> statement-breakpoint
ALTER TABLE crm_records RENAME TO studio_records;
--> statement-breakpoint
ALTER TABLE crm_views RENAME TO studio_views;
--> statement-breakpoint
ALTER TABLE crm_integrations RENAME TO studio_integrations;
--> statement-breakpoint
ALTER TABLE crm_audit RENAME TO studio_audit;
--> statement-breakpoint
ALTER TABLE crm_unique_values RENAME TO studio_unique_values;
--> statement-breakpoint
ALTER TABLE crm_write_guards RENAME TO studio_write_guards;
--> statement-breakpoint
ALTER TABLE crm_requests RENAME TO studio_requests;
--> statement-breakpoint
ALTER TABLE crm_schema_versions RENAME TO studio_schema_versions;
--> statement-breakpoint
ALTER TABLE crm_schema_data RENAME TO studio_schema_data;
--> statement-breakpoint
ALTER TABLE crm_integration_runs RENAME TO studio_integration_runs;
--> statement-breakpoint
ALTER TABLE crm_notes RENAME TO studio_notes;
--> statement-breakpoint
ALTER TABLE crm_files RENAME TO studio_files;
--> statement-breakpoint
ALTER TABLE crm_automations RENAME TO studio_automations;
--> statement-breakpoint
ALTER TABLE crm_automation_runs RENAME TO studio_automation_runs;
--> statement-breakpoint
ALTER TABLE crm_tasks RENAME TO studio_tasks;
--> statement-breakpoint
ALTER TABLE crm_business_links RENAME TO studio_business_links;
--> statement-breakpoint
ALTER TABLE crm_data_domains RENAME TO studio_data_domains;
--> statement-breakpoint
ALTER TABLE crm_collection_sources RENAME TO studio_collection_sources;
--> statement-breakpoint
ALTER TABLE crm_collection_requests RENAME TO studio_collection_requests;
--> statement-breakpoint
ALTER TABLE crm_collection_relations RENAME TO studio_collection_relations;
--> statement-breakpoint
ALTER TABLE crm_record_links RENAME TO studio_record_links;
--> statement-breakpoint
ALTER TABLE crm_native_relation_overrides RENAME TO studio_native_relation_overrides;
--> statement-breakpoint
ALTER TABLE crm_file_drafts RENAME TO studio_file_drafts;
--> statement-breakpoint
ALTER TABLE crm_studio_settings RENAME TO studio_settings;
--> statement-breakpoint
ALTER TABLE crm_solution_installations RENAME TO studio_solution_installations;
--> statement-breakpoint
ALTER TABLE crm_solution_objects RENAME TO studio_solution_objects;
--> statement-breakpoint
ALTER TABLE crm_geocoding_settings RENAME TO studio_geocoding_settings;
--> statement-breakpoint
ALTER TABLE crm_extension_installations RENAME TO studio_extension_installations;
--> statement-breakpoint
ALTER TABLE crm_collection_versions RENAME TO studio_collection_versions;
--> statement-breakpoint
ALTER TABLE crm_file_revisions RENAME TO studio_file_revisions;
--> statement-breakpoint
ALTER TABLE crm_access_deliveries RENAME TO studio_access_deliveries;
--> statement-breakpoint
ALTER TABLE crm_record_history RENAME TO studio_record_history;
--> statement-breakpoint
ALTER TABLE crm_record_history_context RENAME TO studio_record_history_context;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_records_object;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_unique_record;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_records_active;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_integration_runs_history;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_integration_runs_idempotency;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_notes_record;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_files_record;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_tasks_due;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_record_links_incoming;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_files_record_field;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_file_drafts_expiry;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_integrations_owner_index;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_record_history_expiry;
--> statement-breakpoint
DROP VIEW IF EXISTS crm_record_history_fields;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_records_object ON studio_records(tenant_id, object_name, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_unique_record ON studio_unique_values(tenant_id,record_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_records_active ON studio_records(tenant_id,object_name,deleted_at,updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_integration_runs_history ON studio_integration_runs(tenant_id,integration_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS studio_integration_runs_idempotency ON studio_integration_runs(tenant_id,integration_id,operation_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_notes_record ON studio_notes(tenant_id,record_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_files_record ON studio_files(tenant_id,record_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_tasks_due ON studio_tasks(tenant_id,status,due_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_record_links_incoming ON studio_record_links(tenant_id,relation_id,target_id,source_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_files_record_field
  ON studio_files(tenant_id, object_name, record_id, field_name, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_file_drafts_expiry
ON studio_file_drafts(tenant_id, expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_integrations_owner_index ON studio_integrations(tenant_id, owner_principal_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_record_history_expiry ON studio_record_history(expires_at);
--> statement-breakpoint
CREATE VIEW studio_record_history_fields AS
 SELECT o.tenant_id,o.name AS object_name,f.key AS field_name,
 MIN(365,MAX(1,COALESCE(CAST(json_extract(o.config,'$.studio.history.retentionDays') AS INTEGER),90))) AS retention_days
 FROM studio_objects o,json_each(o.config,'$.fields') f
 WHERE json_extract(o.config,'$.studio.history.enabled')=1
 AND json_type(o.config,'$.studio.collection') IS NULL
 AND COALESCE(json_extract(o.config,'$.studio.business'),'') NOT IN ('managed-customer','managed-agency')
 AND json_type(o.config,'$.studio.history.fields')='array'
 AND f.key IN (SELECT value FROM json_each(o.config,'$.studio.history.fields') WHERE type='text' AND key<50)
 AND f.key NOT GLOB '*[^A-Za-z0-9_]*' AND f.key NOT LIKE '\_%' ESCAPE '\'
 AND f.key NOT IN ('id','created_at','updated_at','deleted_at','created_by','updated_by','createdAt','updatedAt','deletedAt','createdBy','updatedBy','constructor','prototype')
 AND json_extract(f.value,'$.type') IN ('Textbox','Textarea','Email','Phone','Url','Address','Number','Currency','Dropdown','Autocomplete','Toggle','DateControl')
 AND COALESCE(json_extract(f.value,'$.hidden'),0)=0
 AND COALESCE(json_extract(f.value,'$.readOnly'),0)=0
 AND COALESCE(json_extract(f.value,'$.config.sensitive'),0)=0
 AND COALESCE(json_extract(f.value,'$.config.readable'),1)<>0
 AND COALESCE(json_extract(f.value,'$.readable'),1)<>0
 AND COALESCE(json_extract(f.value,'$.config.multiple'),0)=0
 AND json_extract(f.value,'$.config.formula') IS NULL
 AND json_extract(f.value,'$.config.relation') IS NULL
 AND json_extract(f.value,'$.config.collectionRelation') IS NULL
 AND json_extract(f.value,'$.config.collectionRelationTarget') IS NULL;
--> statement-breakpoint
CREATE TRIGGER studio_record_links_cardinality BEFORE INSERT ON studio_record_links
BEGIN
 SELECT RAISE(ABORT,'relation_cardinality_conflict') WHERE EXISTS (
 SELECT 1 FROM studio_collection_relations r JOIN studio_record_links e ON e.tenant_id=r.tenant_id AND e.relation_id=r.id
 WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.relation_id
 AND ((r.cardinality='one-to-one' AND e.source_id=NEW.source_id AND e.target_id<>NEW.target_id)
 OR (r.cardinality IN ('one-to-one','one-to-many') AND e.target_id=NEW.target_id AND e.source_id<>NEW.source_id))
 );
END;
--> statement-breakpoint
CREATE TRIGGER studio_relation_definition_update BEFORE UPDATE ON studio_collection_relations
BEGIN
 SELECT RAISE(ABORT,'relation_mapping_has_links') WHERE (NEW.source_field<>OLD.source_field OR NEW.target_field<>OLD.target_field OR NEW.storage<>OLD.storage) AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id);
 SELECT RAISE(ABORT,'relation_cardinality_conflict') WHERE (NEW.cardinality='one-to-one' AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id GROUP BY source_id HAVING count(*)>1)) OR (NEW.cardinality IN ('one-to-one','one-to-many') AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id GROUP BY target_id HAVING count(*)>1));
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_links_storage BEFORE INSERT ON studio_record_links
BEGIN
 SELECT RAISE(ABORT,'relation_mapping_has_links') WHERE EXISTS(SELECT 1 FROM studio_collection_relations WHERE tenant_id=NEW.tenant_id AND id=NEW.relation_id AND storage<>'local');
END;
--> statement-breakpoint
CREATE TRIGGER studio_history_insert AFTER INSERT ON studio_records
 BEGIN
 INSERT INTO studio_record_history(tenant_id,object_name,record_id,version,action,created_at,actor_kind,actor_id,cause_id,changes,expires_at)
 SELECT NEW.tenant_id,NEW.object_name,NEW.id,NEW.version,'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 COALESCE((SELECT actor_kind FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),'system'),
 (SELECT actor_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT cause_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT json_group_object(field_name,json(substr('{}',1,length('{}')-1)||IIF('{}'<>'{}' AND IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}')<>'{}',',','')||substr(IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}'),2))) FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))),
 strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||retention_days||' days')
 FROM studio_record_history_fields
 WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name
 AND ((1) OR EXISTS(SELECT 1 FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))))
 LIMIT 1;
 END;
--> statement-breakpoint
CREATE TRIGGER studio_history_update AFTER UPDATE ON studio_records
 BEGIN
 INSERT INTO studio_record_history(tenant_id,object_name,record_id,version,action,created_at,actor_kind,actor_id,cause_id,changes,expires_at)
 SELECT NEW.tenant_id,NEW.object_name,NEW.id,NEW.version,IIF(OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL,'deleted',IIF(OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL,'restored','updated')),strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 COALESCE((SELECT actor_kind FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),'system'),
 (SELECT actor_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT cause_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT json_group_object(field_name,json(substr(IIF(json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('before',IIF(json_type(OLD.data,'$.'||field_name)='text' AND NOT (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))<=2050),substr(json_extract(OLD.data,'$.'||field_name),1,2048),json((OLD.data -> ('$.'||field_name))))),IIF(json_type(OLD.data,'$.'||field_name)='text' AND (length(json_extract(OLD.data,'$.'||field_name))>2048 OR (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))>2050)),json_object('beforeTruncated',json('true')),'{}')),'{}'),1,length(IIF(json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('before',IIF(json_type(OLD.data,'$.'||field_name)='text' AND NOT (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))<=2050),substr(json_extract(OLD.data,'$.'||field_name),1,2048),json((OLD.data -> ('$.'||field_name))))),IIF(json_type(OLD.data,'$.'||field_name)='text' AND (length(json_extract(OLD.data,'$.'||field_name))>2048 OR (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))>2050)),json_object('beforeTruncated',json('true')),'{}')),'{}'))-1)||IIF(IIF(json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('before',IIF(json_type(OLD.data,'$.'||field_name)='text' AND NOT (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))<=2050),substr(json_extract(OLD.data,'$.'||field_name),1,2048),json((OLD.data -> ('$.'||field_name))))),IIF(json_type(OLD.data,'$.'||field_name)='text' AND (length(json_extract(OLD.data,'$.'||field_name))>2048 OR (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))>2050)),json_object('beforeTruncated',json('true')),'{}')),'{}')<>'{}' AND IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}')<>'{}',',','')||substr(IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}'),2))) FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (((IIF(json_type(OLD.data,'$.'||field_name) IN ('integer','real'),'number',json_type(OLD.data,'$.'||field_name)) IS NOT IIF(json_type(NEW.data,'$.'||field_name) IN ('integer','real'),'number',json_type(NEW.data,'$.'||field_name)) OR json_extract(OLD.data,'$.'||field_name) IS NOT json_extract(NEW.data,'$.'||field_name)) AND (json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false') OR json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))))),
 strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||retention_days||' days')
 FROM studio_record_history_fields
 WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name
 AND ((OLD.deleted_at IS NOT NEW.deleted_at) OR EXISTS(SELECT 1 FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (((IIF(json_type(OLD.data,'$.'||field_name) IN ('integer','real'),'number',json_type(OLD.data,'$.'||field_name)) IS NOT IIF(json_type(NEW.data,'$.'||field_name) IN ('integer','real'),'number',json_type(NEW.data,'$.'||field_name)) OR json_extract(OLD.data,'$.'||field_name) IS NOT json_extract(NEW.data,'$.'||field_name)) AND (json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false') OR json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))))))
 LIMIT 1;
 END;
--> statement-breakpoint
CREATE TRIGGER studio_history_delete AFTER DELETE ON studio_records BEGIN
 DELETE FROM studio_record_history WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name AND record_id=OLD.id;
END;
