CREATE TABLE crm_sync_changes (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 tenant_id TEXT NOT NULL, object_name TEXT NOT NULL,
 id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, created_by TEXT,
 UNIQUE(tenant_id,object_name,id)
);
--> statement-breakpoint
CREATE TABLE crm_sync_receipts (
 tenant_id TEXT NOT NULL, principal_id TEXT NOT NULL, mutation_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, response TEXT NOT NULL,
 before_state TEXT, effects_applied INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,principal_id,mutation_id)
);
--> statement-breakpoint
CREATE TABLE extension_action_runs (
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
  input TEXT NOT NULL CHECK (json_valid(input)),
  output TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, run_id)
);
--> statement-breakpoint
CREATE TABLE extension_connection_audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  actor_principal_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  error_code TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE extension_connections (
  tenant_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  credential_ciphertext TEXT NOT NULL,
  credential_iv TEXT NOT NULL,
  created_by_principal_id TEXT NOT NULL,
  updated_by_principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, extension_id, id)
);
--> statement-breakpoint
CREATE TABLE extension_settings (
  tenant_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  version INTEGER NOT NULL,
  created_by_principal_id TEXT NOT NULL,
  updated_by_principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, extension_id)
);
--> statement-breakpoint
CREATE TABLE notification_admin_audit (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 event_id TEXT NOT NULL, action TEXT NOT NULL, created_at BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE notification_deliveries (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES notification_events(id),
 scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
 channel TEXT NOT NULL DEFAULT 'in-app' CHECK(channel='in-app'), created_at BIGINT NOT NULL,
 read_at BIGINT, archived_at BIGINT, resolved_at BIGINT,
 UNIQUE(event_id,recipient_id,channel)
);
--> statement-breakpoint
CREATE TABLE notification_events (
 id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('workspace','account')), scope_id TEXT NOT NULL,
 event_key TEXT NOT NULL, payload TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 cursor TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_retry BIGINT NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until BIGINT NOT NULL DEFAULT 0, error TEXT,
 UNIQUE(scope_kind,scope_id,event_key)
);
--> statement-breakpoint
CREATE TABLE notification_maintenance_checkpoints (name TEXT PRIMARY KEY, cursor TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE notification_recipient_retries (
 event_id TEXT NOT NULL REFERENCES notification_events(id), recipient_id TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_retry BIGINT NOT NULL, error TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','failed')),
 PRIMARY KEY(event_id,recipient_id)
);
--> statement-breakpoint
CREATE TABLE notification_scope_settings (
 workspace_id TEXT PRIMARY KEY, read_days INTEGER NOT NULL DEFAULT 90 CHECK(read_days BETWEEN 7 AND 365),
 unread_days INTEGER NOT NULL DEFAULT 180 CHECK(unread_days BETWEEN 30 AND 730 AND unread_days>=read_days)
);
--> statement-breakpoint
CREATE TABLE notification_send_limits (
 workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, window_start BIGINT NOT NULL,
 count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 10), PRIMARY KEY(workspace_id,actor_id,window_start)
);
--> statement-breakpoint
CREATE TABLE notification_subscriptions (
 workspace_id TEXT NOT NULL, principal_id TEXT NOT NULL, collection TEXT NOT NULL,
 created_at BIGINT NOT NULL, PRIMARY KEY(workspace_id,principal_id,collection)
);
--> statement-breakpoint
CREATE TABLE plugin_store_artifacts (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
 manifest TEXT NOT NULL CHECK(json_valid(manifest)),
 entry_js TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
 created_by TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), store_json TEXT CHECK(store_json IS NULL OR json_valid(store_json)),
 PRIMARY KEY(tenant_id,id,version)
);
--> statement-breakpoint
CREATE TABLE "studio_access_deliveries" (principal_id TEXT NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL,object_name TEXT NOT NULL,record_id TEXT NOT NULL,PRIMARY KEY(principal_id,scope,revision,object_name,record_id));
--> statement-breakpoint
CREATE TABLE "studio_audit" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, action TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT, detail TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE TABLE "studio_automation_runs" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, automation_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 event_key TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL, task_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(tenant_id,automation_id,event_key)
);
--> statement-breakpoint
CREATE TABLE "studio_automations" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, name TEXT NOT NULL,
 config TEXT NOT NULL CHECK(json_valid(config)), enabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE TABLE "studio_business_links" (
 tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 connection_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('syncing','synced','uncertain')),
 external_object_id TEXT, last_synced_at TEXT,
 PRIMARY KEY(tenant_id,object_name,record_id,connection_id),
 FOREIGN KEY(tenant_id,record_id) REFERENCES "studio_records"(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE "studio_extension_installations" (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 manifest TEXT NOT NULL CHECK(json_valid(manifest)),
 installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE "studio_file_drafts" (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 object_name TEXT NOT NULL,
 field_name TEXT NOT NULL,
 name TEXT NOT NULL,
 mime TEXT NOT NULL,
 size INTEGER NOT NULL,
 storage_key TEXT NOT NULL UNIQUE,
 version INTEGER NOT NULL DEFAULT 1,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE TABLE "studio_file_revisions" (
 tenant_id TEXT NOT NULL,
 file_id TEXT NOT NULL REFERENCES "studio_files"(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version > 0),
 storage_key TEXT NOT NULL UNIQUE,
 size INTEGER NOT NULL CHECK(size > 0),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 created_by TEXT,
 PRIMARY KEY(tenant_id,file_id,version)
);
--> statement-breakpoint
CREATE TABLE "studio_files" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, storage_key TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), field_name TEXT NOT NULL DEFAULT '',
 FOREIGN KEY(tenant_id,record_id) REFERENCES "studio_records"(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE "studio_geocoding_settings" (
  tenant_id TEXT PRIMARY KEY,
  encrypted_geoapify_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
--> statement-breakpoint
CREATE TABLE "studio_integration_runs" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, integration_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 method TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 duration_ms INTEGER NOT NULL DEFAULT 0, error TEXT, response TEXT, idempotency_key TEXT, request_hash TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE TABLE "studio_integrations" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, connection TEXT NOT NULL DEFAULT '{}', encrypted_secret TEXT, owner_principal_id TEXT NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE TABLE "studio_notes" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'note', version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(tenant_id,record_id) REFERENCES "studio_records"(tenant_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "studio_objects" (
 tenant_id TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 config TEXT NOT NULL CHECK(json_valid(config)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY (tenant_id, name)
);
--> statement-breakpoint
CREATE TABLE studio_record_counts (
  tenant_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  active_count INTEGER NOT NULL DEFAULT 0 CHECK(active_count >= 0),
  trash_count INTEGER NOT NULL DEFAULT 0 CHECK(trash_count >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  PRIMARY KEY (tenant_id, object_name)
);
--> statement-breakpoint
CREATE TABLE "studio_record_history" (
 tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 version INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('created','updated','deleted','restored')),
 created_at TEXT NOT NULL, actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user','workflow','public-form','system')),
 actor_id TEXT, cause_id TEXT, changes TEXT NOT NULL CHECK(json_valid(changes)), expires_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,object_name,record_id,version)
);
--> statement-breakpoint
CREATE TABLE "studio_record_history_context" (
 tenant_id TEXT PRIMARY KEY, actor_kind TEXT NOT NULL, actor_id TEXT, cause_id TEXT
);
--> statement-breakpoint
CREATE TABLE studio_record_read_cache (
  tenant_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  revision INTEGER NOT NULL,
  query_fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, object_name, revision, query_fingerprint)
);
--> statement-breakpoint
CREATE TABLE studio_record_search (
  rowid INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  search_text TEXT NOT NULL,
  UNIQUE (tenant_id, object_name, record_id)
);
--> statement-breakpoint
CREATE VIRTUAL TABLE studio_record_search_fts USING fts5(
  search_text,
  tenant_id UNINDEXED,
  object_name UNINDEXED,
  record_id UNINDEXED,
  content='studio_record_search',
  content_rowid='rowid',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TABLE studio_record_summary_definitions (
  tenant_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  group_field TEXT NOT NULL,
  amount_field TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, object_name, group_field, amount_field),
  FOREIGN KEY (tenant_id, object_name) REFERENCES studio_objects(tenant_id, name)
    ON DELETE CASCADE
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE studio_record_summary_groups (
  tenant_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  group_field TEXT NOT NULL,
  amount_field TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('null','number','text')),
  value_key,
  record_count INTEGER NOT NULL CHECK(record_count >= 0),
  amount REAL NOT NULL,
  PRIMARY KEY (tenant_id, object_name, group_field, amount_field, value_type, value_key),
  FOREIGN KEY (tenant_id, object_name, group_field, amount_field)
    REFERENCES studio_record_summary_definitions(tenant_id, object_name, group_field, amount_field)
    ON DELETE CASCADE
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE "studio_records" (
 id TEXT NOT NULL, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, created_by TEXT,
 PRIMARY KEY (tenant_id, id), FOREIGN KEY (tenant_id, object_name) REFERENCES "studio_objects"(tenant_id, name)
);
--> statement-breakpoint
CREATE TABLE "studio_requests"(tenant_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(tenant_id,request_key));
--> statement-breakpoint
CREATE TABLE "studio_schema_data"(tenant_id TEXT NOT NULL,object_name TEXT NOT NULL,version INTEGER NOT NULL,record_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(tenant_id,object_name,version,record_id));
--> statement-breakpoint
CREATE TABLE "studio_schema_versions"(tenant_id TEXT NOT NULL,object_name TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(tenant_id,object_name,version));
--> statement-breakpoint
CREATE TABLE "studio_settings" (
  tenant_id TEXT PRIMARY KEY,
  menu_layout TEXT CHECK(menu_layout IS NULL OR json_valid(menu_layout)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
--> statement-breakpoint
CREATE TABLE "studio_solution_installations" (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 manifest TEXT NOT NULL CHECK(json_valid(manifest)),
 installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE "studio_solution_objects" (
 tenant_id TEXT NOT NULL, solution_id TEXT NOT NULL, object_name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)),
 PRIMARY KEY(tenant_id,object_name),
 FOREIGN KEY(tenant_id,solution_id) REFERENCES "studio_solution_installations"(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE "studio_tasks" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 title TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(tenant_id,record_id) REFERENCES "studio_records"(tenant_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "studio_unique_values" (tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, field_name TEXT NOT NULL, value TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY(tenant_id,object_name,field_name,value));
--> statement-breakpoint
CREATE TABLE "studio_views" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL CHECK(json_valid(config))
);
--> statement-breakpoint
CREATE TABLE "studio_write_guards"(id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
--> statement-breakpoint
CREATE TABLE workflow_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, collection TEXT NOT NULL,
 kind TEXT NOT NULL, before_state TEXT NOT NULL, after_state TEXT NOT NULL,
 depth INTEGER NOT NULL DEFAULT 0, cause TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE workflow_executions (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, workflow_id TEXT NOT NULL, version_id TEXT NOT NULL,
 owner_id TEXT NOT NULL, initiator_id TEXT NOT NULL, event_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting','completed','failed','blocked','cancelled')),
 node_id TEXT, context TEXT NOT NULL CHECK(json_valid(context)), depth INTEGER NOT NULL DEFAULT 0,
 wake_at INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,workflow_id,event_key),
 FOREIGN KEY(workspace_id,version_id) REFERENCES workflow_versions(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE workflow_jobs (
 workspace_id TEXT NOT NULL, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
 sequence INTEGER NOT NULL, type TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL,
 attempts INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,execution_id,node_id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE workflow_tasks (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('task','notification')), title TEXT NOT NULL, assignee TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')), due_at INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,execution_id,node_id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE workflow_versions (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, workflow_id TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)), owner_id TEXT NOT NULL,
 revision INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,workflow_id,revision),
 FOREIGN KEY(workspace_id,workflow_id) REFERENCES workflows(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE workflow_webhook_admissions (
 endpoint_id TEXT NOT NULL, minute INTEGER NOT NULL, count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 60),
 PRIMARY KEY(endpoint_id,minute), FOREIGN KEY(endpoint_id) REFERENCES workflow_webhook_endpoints(id)
);
--> statement-breakpoint
CREATE TABLE workflow_webhook_attempts (
 workspace_id TEXT NOT NULL, execution_id TEXT NOT NULL, node_id TEXT NOT NULL, sequence INTEGER NOT NULL,
 lease_token TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, status INTEGER, error TEXT, output TEXT,
 PRIMARY KEY(workspace_id,execution_id,node_id,sequence),
 FOREIGN KEY(workspace_id,execution_id,node_id) REFERENCES workflow_webhook_deliveries(workspace_id,execution_id,node_id)
);
--> statement-breakpoint
CREATE TABLE workflow_webhook_deliveries (
 workspace_id TEXT NOT NULL, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
 destination_id TEXT NOT NULL, destination_revision INTEGER NOT NULL, payload TEXT NOT NULL, stable_key TEXT NOT NULL,
 attempt_count INTEGER NOT NULL DEFAULT 0, retry_generation INTEGER NOT NULL DEFAULT 0, generation_attempts INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'prepared',
 PRIMARY KEY(workspace_id,execution_id,node_id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id),
 FOREIGN KEY(workspace_id,destination_id,destination_revision) REFERENCES workflow_webhook_destination_versions(workspace_id,id,revision)
);
--> statement-breakpoint
CREATE TABLE workflow_webhook_destination_versions (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, url TEXT NOT NULL, auth_type TEXT NOT NULL, auth_header TEXT,
 PRIMARY KEY(workspace_id,id,revision), FOREIGN KEY(workspace_id,id) REFERENCES workflow_webhook_destinations(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE workflow_webhook_destinations (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, current_revision INTEGER NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1, encrypted_secret TEXT, credential_type TEXT NOT NULL, credential_header TEXT,
 PRIMARY KEY(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE workflow_webhook_endpoints (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL UNIQUE, workflow_id TEXT NOT NULL, secret_hash TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,workflow_id),
 FOREIGN KEY(workspace_id,workflow_id) REFERENCES workflows(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE workflow_webhook_receipts (
 workspace_id TEXT NOT NULL, endpoint_id TEXT NOT NULL, event_key TEXT NOT NULL, payload_hash TEXT NOT NULL, execution_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,endpoint_id,event_key),
 FOREIGN KEY(workspace_id,endpoint_id) REFERENCES workflow_webhook_endpoints(workspace_id,id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE workflow_write_context (
 workspace_id TEXT NOT NULL, record_id TEXT NOT NULL, depth INTEGER NOT NULL, cause TEXT NOT NULL,
 PRIMARY KEY(workspace_id,record_id)
);
--> statement-breakpoint
CREATE TABLE workflows (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)), revision INTEGER NOT NULL DEFAULT 1,
 enabled INTEGER NOT NULL DEFAULT 0, published_version TEXT, created_by TEXT NOT NULL,
 next_run_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,id)
);
--> statement-breakpoint
CREATE INDEX crm_sync_changes_scope ON crm_sync_changes(tenant_id,object_name,sequence);
--> statement-breakpoint
CREATE INDEX extension_action_runs_tenant_updated_index
  ON extension_action_runs (tenant_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX extension_connection_audit_events_tenant_created_index
  ON extension_connection_audit_events (tenant_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX extension_connections_tenant_updated_index
  ON extension_connections (tenant_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX extension_settings_tenant_updated_index
  ON extension_settings (tenant_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX idx_plugin_store_artifacts_tenant ON plugin_store_artifacts(tenant_id,id);
--> statement-breakpoint
CREATE INDEX notification_audit_scope ON notification_admin_audit(workspace_id,created_at,id);
--> statement-breakpoint
CREATE INDEX notification_events_due ON notification_events(status,next_retry,lease_until,created_at,id);
--> statement-breakpoint
CREATE INDEX notification_followers ON notification_subscriptions(workspace_id,collection,principal_id,created_at);
--> statement-breakpoint
CREATE INDEX notification_inbox ON notification_deliveries(recipient_id,scope_kind,scope_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE INDEX notification_retries_due ON notification_recipient_retries(status,next_retry,event_id);
--> statement-breakpoint
CREATE INDEX notification_unread ON notification_deliveries(recipient_id,scope_kind,scope_id,read_at,archived_at);
--> statement-breakpoint
CREATE INDEX studio_file_drafts_expiry
ON studio_file_drafts(tenant_id, expires_at);
--> statement-breakpoint
CREATE INDEX studio_files_record ON studio_files(tenant_id,record_id,created_at);
--> statement-breakpoint
CREATE INDEX studio_files_record_field
  ON studio_files(tenant_id, object_name, record_id, field_name, created_at);
--> statement-breakpoint
CREATE INDEX studio_integration_runs_history ON studio_integration_runs(tenant_id,integration_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX studio_integration_runs_idempotency ON studio_integration_runs(tenant_id,integration_id,operation_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX studio_integrations_owner_index ON studio_integrations(tenant_id, owner_principal_id);
--> statement-breakpoint
CREATE INDEX studio_notes_record ON studio_notes(tenant_id,record_id,created_at);
--> statement-breakpoint
CREATE INDEX studio_record_history_expiry ON studio_record_history(expires_at);
--> statement-breakpoint
CREATE INDEX studio_record_read_cache_expiry ON studio_record_read_cache(expires_at);
--> statement-breakpoint
CREATE INDEX studio_records_active ON studio_records(tenant_id,object_name,deleted_at,updated_at);
--> statement-breakpoint
CREATE INDEX studio_records_active_created_order
  ON studio_records(tenant_id, object_name, deleted_at, created_at DESC, id ASC);
--> statement-breakpoint
CREATE INDEX studio_records_active_updated_order
  ON studio_records(tenant_id, object_name, deleted_at, updated_at DESC, id ASC);
--> statement-breakpoint
CREATE INDEX studio_records_object ON studio_records(tenant_id, object_name, updated_at);
--> statement-breakpoint
CREATE INDEX studio_tasks_due ON studio_tasks(tenant_id,status,due_at);
--> statement-breakpoint
CREATE INDEX studio_unique_record ON studio_unique_values(tenant_id,record_id);
--> statement-breakpoint
CREATE INDEX workflow_executions_due ON workflow_executions(status,wake_at,lease_until);
--> statement-breakpoint
CREATE INDEX workflow_executions_history ON workflow_executions(workspace_id,workflow_id,created_at);
--> statement-breakpoint
CREATE INDEX workflow_tasks_inbox ON workflow_tasks(workspace_id,assignee,status);
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
CREATE TRIGGER crm_sync_delete AFTER DELETE ON "studio_records" BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (OLD.tenant_id,OLD.object_name,OLD.id,OLD.data,OLD.version+1,OLD.created_at,OLD.updated_at,COALESCE(OLD.deleted_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),OLD.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_insert AFTER INSERT ON "studio_records" BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.data,NEW.version,NEW.created_at,NEW.updated_at,NEW.deleted_at,NEW.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_update AFTER UPDATE ON "studio_records" BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.data,NEW.version,NEW.created_at,NEW.updated_at,NEW.deleted_at,NEW.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
END;
--> statement-breakpoint
CREATE TRIGGER notification_event_fanout AFTER INSERT ON notification_events
BEGIN
INSERT OR IGNORE INTO notification_deliveries(id,event_id,scope_kind,scope_id,recipient_id,created_at)
SELECT 'dlv_'||NEW.id||'_'||s.principal_id,NEW.id,NEW.scope_kind,NEW.scope_id,s.principal_id,NEW.created_at
FROM notification_subscriptions s
WHERE s.workspace_id=NEW.scope_id
 AND s.collection=json_extract(NEW.payload,'$.audience.collection')
 AND json_extract(NEW.payload,'$.audience.kind')='collection-followers'
 AND (json_extract(NEW.payload,'$.actor.id') IS NULL OR s.principal_id<>json_extract(NEW.payload,'$.actor.id'));
END;
--> statement-breakpoint
CREATE TRIGGER notification_record_insert AFTER INSERT ON "studio_records"
BEGIN
INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at)
SELECT 'ntf_'||lower(hex(randomblob(8))),'workspace',NEW.tenant_id,
 'record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 json_object('scope',json_object('kind','workspace','id',NEW.tenant_id),'key','record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 'actor',json_object('kind',COALESCE((SELECT actor_kind FROM "studio_record_history_context" WHERE tenant_id=NEW.tenant_id),'system'),'id',(SELECT actor_id FROM "studio_record_history_context" WHERE tenant_id=NEW.tenant_id)),
 'source',json_object('kind','record','collection',NEW.object_name,'id',NEW.id,'operation','created'),
 'title',NEW.object_name||' created','body','',
 'audience',json_object('kind','collection-followers','collection',NEW.object_name),
 'createdAt',CAST(strftime('%s','now') AS INTEGER)*1000,'expiresAt',json('null')),
 CAST(strftime('%s','now') AS INTEGER)*1000
WHERE EXISTS(SELECT 1 FROM notification_subscriptions WHERE workspace_id=NEW.tenant_id AND collection=NEW.object_name);
END;
--> statement-breakpoint
CREATE TRIGGER notification_record_purge AFTER DELETE ON "studio_records"
BEGIN
INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at)
SELECT 'ntf_'||lower(hex(randomblob(8))),'workspace',OLD.tenant_id,
 'record:'||OLD.tenant_id||':'||OLD.object_name||':'||OLD.id||':purged',
 json_object('scope',json_object('kind','workspace','id',OLD.tenant_id),'key','record:'||OLD.tenant_id||':'||OLD.object_name||':'||OLD.id||':purged',
 'actor',json_object('kind','system','id',NULL),
 'source',json_object('kind','record','collection',OLD.object_name,'id',OLD.id,'operation','deleted'),
 'title',OLD.object_name||' deleted','body','',
 'audience',json_object('kind','collection-followers','collection',OLD.object_name),
 'createdAt',CAST(strftime('%s','now') AS INTEGER)*1000,'expiresAt',json('null')),
 CAST(strftime('%s','now') AS INTEGER)*1000
WHERE EXISTS(SELECT 1 FROM notification_subscriptions WHERE workspace_id=OLD.tenant_id AND collection=OLD.object_name);
END;
--> statement-breakpoint
CREATE TRIGGER notification_record_update AFTER UPDATE ON "studio_records"
WHEN OLD.data IS NOT NEW.data OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
BEGIN
INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at)
SELECT 'ntf_'||lower(hex(randomblob(8))),'workspace',NEW.tenant_id,
 'record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 json_object('scope',json_object('kind','workspace','id',NEW.tenant_id),'key','record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 'actor',json_object('kind',COALESCE((SELECT actor_kind FROM "studio_record_history_context" WHERE tenant_id=NEW.tenant_id),'system'),'id',(SELECT actor_id FROM "studio_record_history_context" WHERE tenant_id=NEW.tenant_id)),
 'source',json_object('kind','record','collection',NEW.object_name,'id',NEW.id,'operation',
  CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'created' ELSE 'updated' END),
 'title',NEW.object_name||' '||CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restored' ELSE 'updated' END,'body','',
 'audience',json_object('kind','collection-followers','collection',NEW.object_name),
 'createdAt',CAST(strftime('%s','now') AS INTEGER)*1000,'expiresAt',json('null')),
 CAST(strftime('%s','now') AS INTEGER)*1000
WHERE EXISTS(SELECT 1 FROM notification_subscriptions WHERE workspace_id=NEW.tenant_id AND collection=NEW.object_name);
END;
--> statement-breakpoint
CREATE TRIGGER studio_history_delete AFTER DELETE ON studio_records BEGIN
 DELETE FROM studio_record_history WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name AND record_id=OLD.id;
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
CREATE TRIGGER studio_record_counts_delete AFTER DELETE ON studio_records
BEGIN
  UPDATE studio_record_counts
  SET active_count = active_count - CASE WHEN OLD.deleted_at IS NULL THEN 1 ELSE 0 END,
      trash_count = trash_count - CASE WHEN OLD.deleted_at IS NULL THEN 0 ELSE 1 END,
      revision = revision + 1
  WHERE tenant_id = OLD.tenant_id AND object_name = OLD.object_name;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_counts_insert AFTER INSERT ON studio_records
BEGIN
  INSERT INTO studio_record_counts(tenant_id, object_name, active_count, trash_count, revision)
  VALUES(NEW.tenant_id, NEW.object_name,
         CASE WHEN NEW.deleted_at IS NULL THEN 1 ELSE 0 END,
         CASE WHEN NEW.deleted_at IS NULL THEN 0 ELSE 1 END,
         1)
  ON CONFLICT(tenant_id, object_name) DO UPDATE SET
    active_count = active_count + excluded.active_count,
    trash_count = trash_count + excluded.trash_count,
    revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_counts_update_new AFTER UPDATE ON studio_records
BEGIN
  INSERT INTO studio_record_counts(tenant_id, object_name, active_count, trash_count, revision)
  VALUES(NEW.tenant_id, NEW.object_name,
         CASE WHEN NEW.deleted_at IS NULL THEN 1 ELSE 0 END,
         CASE WHEN NEW.deleted_at IS NULL THEN 0 ELSE 1 END,
         1)
  ON CONFLICT(tenant_id, object_name) DO UPDATE SET
    active_count = active_count + excluded.active_count,
    trash_count = trash_count + excluded.trash_count,
    revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_counts_update_old BEFORE UPDATE ON studio_records
BEGIN
  UPDATE studio_record_counts
  SET active_count = active_count - CASE WHEN OLD.deleted_at IS NULL THEN 1 ELSE 0 END,
      trash_count = trash_count - CASE WHEN OLD.deleted_at IS NULL THEN 0 ELSE 1 END,
      revision = revision + CASE
        WHEN OLD.tenant_id <> NEW.tenant_id OR OLD.object_name <> NEW.object_name THEN 1
        ELSE 0
      END
  WHERE tenant_id = OLD.tenant_id AND object_name = OLD.object_name;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_search_delete AFTER DELETE ON studio_records BEGIN
  DELETE FROM studio_record_search
  WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name AND record_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_search_fts_before_delete BEFORE DELETE ON studio_record_search BEGIN
  INSERT INTO studio_record_search_fts(studio_record_search_fts, rowid, search_text, tenant_id, object_name, record_id)
  VALUES ('delete', OLD.rowid, OLD.search_text, OLD.tenant_id, OLD.object_name, OLD.record_id);
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_search_fts_before_update BEFORE UPDATE ON studio_record_search BEGIN
  INSERT INTO studio_record_search_fts(studio_record_search_fts, rowid, search_text, tenant_id, object_name, record_id)
  VALUES ('delete', OLD.rowid, OLD.search_text, OLD.tenant_id, OLD.object_name, OLD.record_id);
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_search_fts_insert AFTER INSERT ON studio_record_search BEGIN
  INSERT INTO studio_record_search_fts(rowid, search_text, tenant_id, object_name, record_id)
  VALUES (NEW.rowid, NEW.search_text, NEW.tenant_id, NEW.object_name, NEW.record_id);
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_search_fts_update AFTER UPDATE ON studio_record_search BEGIN
  INSERT INTO studio_record_search_fts(rowid, search_text, tenant_id, object_name, record_id)
  VALUES (NEW.rowid, NEW.search_text, NEW.tenant_id, NEW.object_name, NEW.record_id);
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_search_insert AFTER INSERT ON studio_records BEGIN
  INSERT INTO studio_record_search(rowid, tenant_id, object_name, record_id, search_text)
  SELECT NEW.rowid, NEW.tenant_id, NEW.object_name, NEW.id,
         COALESCE((SELECT group_concat(CAST(search.value AS TEXT), '')
                   FROM json_each(NEW.data, '$') AS search), '')
  ON CONFLICT(tenant_id, object_name, record_id) DO UPDATE SET
    rowid=excluded.rowid, search_text=excluded.search_text;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_search_update
AFTER UPDATE OF tenant_id, object_name, id, data ON studio_records BEGIN
  UPDATE studio_record_search SET
    rowid=NEW.rowid,
    tenant_id=NEW.tenant_id,
    object_name=NEW.object_name,
    record_id=NEW.id,
    search_text=COALESCE((SELECT group_concat(CAST(search.value AS TEXT), '')
                          FROM json_each(NEW.data, '$') AS search), '')
  WHERE rowid=OLD.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_summary_delete AFTER DELETE ON studio_records BEGIN
  DELETE FROM studio_record_summary_groups
  WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name
    AND record_count=1 AND OLD.deleted_at IS NULL
    AND (group_field,amount_field,value_type,value_key) IN (
      SELECT d.group_field,d.amount_field,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN 'null'
                  WHEN typeof(json_extract(OLD.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN ''
                  ELSE json_extract(OLD.data, '$.' || d.group_field) END
      FROM studio_record_summary_definitions AS d
      WHERE d.tenant_id=OLD.tenant_id AND d.object_name=OLD.object_name
    );
  UPDATE studio_record_summary_groups
  SET record_count=record_count-1,
      amount=amount-CASE WHEN amount_field='' THEN 0.0
                         ELSE COALESCE(CAST(json_extract(OLD.data, '$.' || amount_field) AS REAL), 0.0) END
  WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name
    AND record_count>1 AND OLD.deleted_at IS NULL
    AND (group_field,amount_field,value_type,value_key) IN (
      SELECT d.group_field,d.amount_field,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN 'null'
                  WHEN typeof(json_extract(OLD.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN ''
                  ELSE json_extract(OLD.data, '$.' || d.group_field) END
      FROM studio_record_summary_definitions AS d
      WHERE d.tenant_id=OLD.tenant_id AND d.object_name=OLD.object_name
    );
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_summary_insert AFTER INSERT ON studio_records BEGIN
  INSERT INTO studio_record_summary_groups
    (tenant_id, object_name, group_field, amount_field, value_type, value_key, record_count, amount)
  SELECT d.tenant_id, d.object_name, d.group_field, d.amount_field,
         CASE WHEN json_extract(NEW.data, '$.' || d.group_field) IS NULL THEN 'null'
              WHEN typeof(json_extract(NEW.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
         CASE WHEN json_extract(NEW.data, '$.' || d.group_field) IS NULL THEN ''
              ELSE json_extract(NEW.data, '$.' || d.group_field) END,
         1,
         CASE WHEN d.amount_field='' THEN 0.0
              ELSE COALESCE(CAST(json_extract(NEW.data, '$.' || d.amount_field) AS REAL), 0.0) END
  FROM studio_record_summary_definitions AS d
  WHERE d.tenant_id=NEW.tenant_id AND d.object_name=NEW.object_name
    AND NEW.deleted_at IS NULL
  ON CONFLICT(tenant_id, object_name, group_field, amount_field, value_type, value_key)
  DO UPDATE SET record_count=record_count+1, amount=amount+excluded.amount;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_summary_update AFTER UPDATE ON studio_records BEGIN
  DELETE FROM studio_record_summary_groups
  WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name
    AND record_count=1 AND OLD.deleted_at IS NULL
    AND (group_field,amount_field,value_type,value_key) IN (
      SELECT d.group_field,d.amount_field,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN 'null'
                  WHEN typeof(json_extract(OLD.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN ''
                  ELSE json_extract(OLD.data, '$.' || d.group_field) END
      FROM studio_record_summary_definitions AS d
      WHERE d.tenant_id=OLD.tenant_id AND d.object_name=OLD.object_name
    );
  UPDATE studio_record_summary_groups
  SET record_count=record_count-1,
      amount=amount-CASE WHEN amount_field='' THEN 0.0
                         ELSE COALESCE(CAST(json_extract(OLD.data, '$.' || amount_field) AS REAL), 0.0) END
  WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name
    AND record_count>1 AND OLD.deleted_at IS NULL
    AND (group_field,amount_field,value_type,value_key) IN (
      SELECT d.group_field,d.amount_field,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN 'null'
                  WHEN typeof(json_extract(OLD.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN ''
                  ELSE json_extract(OLD.data, '$.' || d.group_field) END
      FROM studio_record_summary_definitions AS d
      WHERE d.tenant_id=OLD.tenant_id AND d.object_name=OLD.object_name
    );
  INSERT INTO studio_record_summary_groups
    (tenant_id, object_name, group_field, amount_field, value_type, value_key, record_count, amount)
  SELECT d.tenant_id, d.object_name, d.group_field, d.amount_field,
         CASE WHEN json_extract(NEW.data, '$.' || d.group_field) IS NULL THEN 'null'
              WHEN typeof(json_extract(NEW.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
         CASE WHEN json_extract(NEW.data, '$.' || d.group_field) IS NULL THEN ''
              ELSE json_extract(NEW.data, '$.' || d.group_field) END,
         1,
         CASE WHEN d.amount_field='' THEN 0.0
              ELSE COALESCE(CAST(json_extract(NEW.data, '$.' || d.amount_field) AS REAL), 0.0) END
  FROM studio_record_summary_definitions AS d
  WHERE d.tenant_id=NEW.tenant_id AND d.object_name=NEW.object_name
    AND NEW.deleted_at IS NULL
  ON CONFLICT(tenant_id, object_name, group_field, amount_field, value_type, value_key)
  DO UPDATE SET record_count=record_count+1, amount=amount+excluded.amount;
END;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER workflow_record_created AFTER INSERT ON "studio_records"
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
--> statement-breakpoint
CREATE TRIGGER workflow_record_deleted AFTER UPDATE OF deleted_at ON "studio_records"
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
--> statement-breakpoint
CREATE TRIGGER workflow_record_hard_deleted AFTER DELETE ON "studio_records"
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
--> statement-breakpoint
CREATE TRIGGER workflow_record_updated AFTER UPDATE OF data ON "studio_records"
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
