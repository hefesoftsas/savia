ALTER TABLE office_documents ADD COLUMN source_key TEXT;
CREATE UNIQUE INDEX office_documents_owner_source_key
  ON office_documents (tenant_id, owner_id, source_key);
