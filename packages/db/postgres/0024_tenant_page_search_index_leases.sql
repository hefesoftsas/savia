CREATE TABLE savia_core.tenant_page_search_index_leases (
  tenant_id BIGINT NOT NULL REFERENCES savia_core.tenants(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES savia_core.pages(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, page_id)
);
