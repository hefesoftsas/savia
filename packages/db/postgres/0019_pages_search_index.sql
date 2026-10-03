CREATE TABLE tenant_page_search_index (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version BIGINT NOT NULL,
  vector_ids TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
