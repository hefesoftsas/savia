ALTER TABLE crm_files ADD COLUMN field_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS crm_files_record_field
  ON crm_files(tenant_id, object_name, record_id, field_name, created_at);
