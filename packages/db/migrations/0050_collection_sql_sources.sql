-- NocoBase-style external sources: allow Postgres alongside JSON:API.
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt and
-- existing rows are preserved. Secrets stay in encrypted_secret.
CREATE TABLE _crm_collection_sources_new (
  tenant_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('jsonapi','postgres')),
  config TEXT NOT NULL CHECK(json_valid(config)),
  encrypted_secret TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(tenant_id,owner_principal_id,id)
);
--> statement-breakpoint
INSERT INTO _crm_collection_sources_new
  (tenant_id,owner_principal_id,id,label,kind,config,encrypted_secret,created_at)
  SELECT tenant_id,owner_principal_id,id,label,kind,config,encrypted_secret,created_at
  FROM crm_collection_sources;
--> statement-breakpoint
DROP TABLE crm_collection_sources;
--> statement-breakpoint
ALTER TABLE _crm_collection_sources_new RENAME TO crm_collection_sources;
