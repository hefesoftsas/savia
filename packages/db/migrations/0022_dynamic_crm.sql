CREATE TABLE IF NOT EXISTS crm_objects (
 tenant_id TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 config TEXT NOT NULL CHECK(json_valid(config)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (tenant_id, name)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_records (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (tenant_id, id), FOREIGN KEY (tenant_id, object_name) REFERENCES crm_objects(tenant_id, name)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_records_object ON crm_records(tenant_id, object_name, updated_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_views (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL CHECK(json_valid(config))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_integrations (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_audit (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, action TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT, detail TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
ALTER TABLE crm_objects ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE crm_records ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE crm_records ADD COLUMN deleted_at TEXT;
--> statement-breakpoint
CREATE TABLE crm_unique_values (tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, field_name TEXT NOT NULL, value TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY(tenant_id,object_name,field_name,value));
--> statement-breakpoint
CREATE INDEX crm_unique_record ON crm_unique_values(tenant_id,record_id);
--> statement-breakpoint
CREATE TABLE crm_write_guards(id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
--> statement-breakpoint
CREATE TABLE crm_requests(tenant_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(tenant_id,request_key));
--> statement-breakpoint
CREATE TABLE crm_schema_versions(tenant_id TEXT NOT NULL,object_name TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(tenant_id,object_name,version));
--> statement-breakpoint
CREATE TABLE crm_schema_data(tenant_id TEXT NOT NULL,object_name TEXT NOT NULL,version INTEGER NOT NULL,record_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(tenant_id,object_name,version,record_id));
--> statement-breakpoint
INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition) SELECT tenant_id,name,version,json_object('name',name,'label',label,'description',description,'config',json(config),'version',version) FROM crm_objects;
--> statement-breakpoint
CREATE INDEX crm_records_active ON crm_records(tenant_id,object_name,deleted_at,updated_at);
--> statement-breakpoint
ALTER TABLE crm_integrations ADD COLUMN connection TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE crm_integrations ADD COLUMN encrypted_secret TEXT;
--> statement-breakpoint
CREATE TABLE crm_integration_runs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, integration_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 method TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 duration_ms INTEGER NOT NULL DEFAULT 0, error TEXT, response TEXT, idempotency_key TEXT, request_hash TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE INDEX crm_integration_runs_history ON crm_integration_runs(tenant_id,integration_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX crm_integration_runs_idempotency ON crm_integration_runs(tenant_id,integration_id,operation_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_notes (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'note', version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(tenant_id,record_id) REFERENCES crm_records(tenant_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_notes_record ON crm_notes(tenant_id,record_id,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_files (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, storage_key TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(tenant_id,record_id) REFERENCES crm_records(tenant_id,id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_files_record ON crm_files(tenant_id,record_id,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_automations (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, name TEXT NOT NULL,
 config TEXT NOT NULL CHECK(json_valid(config)), enabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_automation_runs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, automation_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 event_key TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL, task_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(tenant_id,automation_id,event_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_tasks (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 title TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(tenant_id,record_id) REFERENCES crm_records(tenant_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_tasks_due ON crm_tasks(tenant_id,status,due_at);
