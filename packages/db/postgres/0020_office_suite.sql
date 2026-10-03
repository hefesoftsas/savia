CREATE TABLE office_documents (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  storage_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX office_documents_owner_updated
  ON office_documents(tenant_id, owner_id, updated_at);

CREATE TABLE office_document_revisions (
  document_id TEXT NOT NULL REFERENCES office_documents(id) ON DELETE CASCADE,
  version BIGINT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  size BIGINT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES identity_principal(id) ON DELETE SET NULL,
  PRIMARY KEY (document_id, version)
);

CREATE TABLE office_settings (
  tenant_id BIGINT PRIMARY KEY NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform_allowed BIGINT NOT NULL DEFAULT 1 CHECK (platform_allowed IN (0, 1)),
  tenant_enabled BIGINT NOT NULL DEFAULT 1 CHECK (tenant_enabled IN (0, 1)),
  updated_by TEXT REFERENCES identity_principal(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE connected_office_document_operations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'onedrive_personal', 'onedrive_business')),
  format TEXT NOT NULL CHECK (format IN ('docx', 'xlsx', 'pptx')),
  name TEXT NOT NULL,
  provider_file_id TEXT,
  provider_drive_id TEXT,
  nango_connection_id TEXT NOT NULL,
  url TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, owner_id, request_id)
);

CREATE INDEX connected_office_documents_owner_created
  ON connected_office_document_operations(tenant_id, owner_id, state, created_at DESC);

CREATE UNIQUE INDEX connected_office_documents_provider_file
  ON connected_office_document_operations(tenant_id, owner_id, provider, provider_file_id)
  WHERE provider_file_id IS NOT NULL;
