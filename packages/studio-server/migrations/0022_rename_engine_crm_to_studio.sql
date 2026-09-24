-- Fase 3: rename low-code engine tables crm_* -> studio_*.
-- External HubSpot sync tables (crm_connections, crm_sync_*, ...)
-- intentionally keep their names. Old migrations are immutable.
-- this file is the single rename step, applied once per database.
PRAGMA defer_foreign_keys = ON;

DROP TRIGGER IF EXISTS crm_history_insert;
DROP TRIGGER IF EXISTS crm_history_update;
DROP TRIGGER IF EXISTS crm_history_delete;
ALTER TABLE crm_objects RENAME TO studio_objects;
ALTER TABLE crm_records RENAME TO studio_records;
ALTER TABLE crm_views RENAME TO studio_views;
ALTER TABLE crm_integrations RENAME TO studio_integrations;
ALTER TABLE crm_audit RENAME TO studio_audit;
ALTER TABLE crm_unique_values RENAME TO studio_unique_values;
ALTER TABLE crm_write_guards RENAME TO studio_write_guards;
ALTER TABLE crm_requests RENAME TO studio_requests;
ALTER TABLE crm_schema_versions RENAME TO studio_schema_versions;
ALTER TABLE crm_schema_data RENAME TO studio_schema_data;
ALTER TABLE crm_integration_runs RENAME TO studio_integration_runs;
ALTER TABLE crm_notes RENAME TO studio_notes;
ALTER TABLE crm_files RENAME TO studio_files;
ALTER TABLE crm_automations RENAME TO studio_automations;
ALTER TABLE crm_automation_runs RENAME TO studio_automation_runs;
ALTER TABLE crm_tasks RENAME TO studio_tasks;
ALTER TABLE crm_business_links RENAME TO studio_business_links;
ALTER TABLE crm_file_drafts RENAME TO studio_file_drafts;
ALTER TABLE crm_geocoding_settings RENAME TO studio_geocoding_settings;
ALTER TABLE crm_studio_settings RENAME TO studio_settings;
ALTER TABLE crm_solution_installations RENAME TO studio_solution_installations;
ALTER TABLE crm_solution_objects RENAME TO studio_solution_objects;
ALTER TABLE crm_extension_installations RENAME TO studio_extension_installations;
ALTER TABLE crm_access_deliveries RENAME TO studio_access_deliveries;
ALTER TABLE crm_file_revisions RENAME TO studio_file_revisions;
ALTER TABLE crm_record_history RENAME TO studio_record_history;
ALTER TABLE crm_record_history_context RENAME TO studio_record_history_context;
DROP INDEX IF EXISTS crm_records_object;
DROP INDEX IF EXISTS crm_unique_record;
DROP INDEX IF EXISTS crm_records_active;
DROP INDEX IF EXISTS crm_integration_runs_history;
DROP INDEX IF EXISTS crm_integration_runs_idempotency;
DROP INDEX IF EXISTS crm_notes_record;
DROP INDEX IF EXISTS crm_files_record;
DROP INDEX IF EXISTS crm_tasks_due;
DROP INDEX IF EXISTS crm_files_record_field;
DROP INDEX IF EXISTS crm_file_drafts_expiry;
DROP INDEX IF EXISTS crm_integrations_owner_index;
DROP INDEX IF EXISTS crm_record_history_expiry;
DROP VIEW IF EXISTS crm_record_history_fields;
CREATE INDEX IF NOT EXISTS studio_records_object ON studio_records(tenant_id, object_name, updated_at);
CREATE INDEX IF NOT EXISTS studio_unique_record ON studio_unique_values(tenant_id,record_id);
CREATE INDEX IF NOT EXISTS studio_records_active ON studio_records(tenant_id,object_name,deleted_at,updated_at);
CREATE INDEX IF NOT EXISTS studio_integration_runs_history ON studio_integration_runs(tenant_id,integration_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS studio_integration_runs_idempotency ON studio_integration_runs(tenant_id,integration_id,operation_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS studio_notes_record ON studio_notes(tenant_id,record_id,created_at);
CREATE INDEX IF NOT EXISTS studio_files_record ON studio_files(tenant_id,record_id,created_at);
CREATE INDEX IF NOT EXISTS studio_tasks_due ON studio_tasks(tenant_id,status,due_at);
CREATE INDEX IF NOT EXISTS studio_files_record_field
  ON studio_files(tenant_id, object_name, record_id, field_name, created_at);
CREATE INDEX IF NOT EXISTS studio_file_drafts_expiry
ON studio_file_drafts(tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS studio_integrations_owner_index ON studio_integrations(tenant_id, owner_principal_id);
CREATE INDEX IF NOT EXISTS studio_record_history_expiry ON studio_record_history(expires_at);
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
CREATE TRIGGER studio_history_delete AFTER DELETE ON studio_records BEGIN
 DELETE FROM studio_record_history WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name AND record_id=OLD.id;
END;
