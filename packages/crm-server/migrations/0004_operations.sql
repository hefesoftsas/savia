CREATE TABLE IF NOT EXISTS crm_notes (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'note', version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(tenant_id,record_id) REFERENCES crm_records(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_notes_record ON crm_notes(tenant_id,record_id,created_at);
CREATE TABLE IF NOT EXISTS crm_files (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, storage_key TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(tenant_id,record_id) REFERENCES crm_records(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS crm_files_record ON crm_files(tenant_id,record_id,created_at);
CREATE TABLE IF NOT EXISTS crm_automations (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, name TEXT NOT NULL,
 config TEXT NOT NULL CHECK(json_valid(config)), enabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS crm_automation_runs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, automation_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 event_key TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL, task_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(tenant_id,automation_id,event_key)
);
CREATE TABLE IF NOT EXISTS crm_tasks (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 title TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(tenant_id,record_id) REFERENCES crm_records(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_tasks_due ON crm_tasks(tenant_id,status,due_at);
