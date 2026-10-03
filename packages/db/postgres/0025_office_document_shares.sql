ALTER TABLE office_documents
  ADD COLUMN share_version BIGINT NOT NULL DEFAULT 1;

CREATE TABLE office_document_shares (
  document_id TEXT NOT NULL REFERENCES office_documents(id) ON DELETE CASCADE,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('reader', 'editor')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, principal_id)
);

CREATE INDEX office_document_shares_member
  ON office_document_shares(tenant_id, principal_id, document_id);
