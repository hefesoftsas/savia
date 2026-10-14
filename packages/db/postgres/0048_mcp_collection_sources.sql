ALTER TABLE savia_core.studio_collection_sources
  DROP CONSTRAINT studio_collection_sources_kind_check;
--> statement-breakpoint
ALTER TABLE savia_core.studio_collection_sources
  ADD CONSTRAINT studio_collection_sources_kind_check
  CHECK (kind = ANY (ARRAY['jsonapi'::text, 'postgres'::text, 'mysql'::text, 'mssql'::text, 'mongodb'::text, 'mcp'::text]));
--> statement-breakpoint
CREATE TABLE savia_core.studio_mcp_oauth_flows (
  state TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  encrypted_flow TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
--> statement-breakpoint
CREATE INDEX studio_mcp_oauth_flows_expiry
  ON savia_core.studio_mcp_oauth_flows(expires_at);
