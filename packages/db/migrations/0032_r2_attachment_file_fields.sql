-- Persist which CRM field owns a stored file, matching the CRM engine migration 0006.
ALTER TABLE crm_files ADD COLUMN field_name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_files_record_field
  ON crm_files(tenant_id, object_name, record_id, field_name, created_at);
--> statement-breakpoint
-- Replace incomplete draft tables (created without field/expiry columns) with the temporary R2 schema.
DROP TABLE IF EXISTS crm_file_drafts;
--> statement-breakpoint
CREATE TABLE crm_file_drafts (
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
CREATE INDEX IF NOT EXISTS crm_file_drafts_expiry
ON crm_file_drafts(tenant_id, expires_at);
