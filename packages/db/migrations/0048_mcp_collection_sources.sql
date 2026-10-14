-- Extend the source discriminator without changing existing source ownership.
CREATE TABLE studio_collection_sources_mcp (
 tenant_id TEXT NOT NULL,
 owner_principal_id TEXT NOT NULL,
 id TEXT NOT NULL,
 label TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('jsonapi','postgres','mysql','mssql','mongodb','mcp')),
 config TEXT NOT NULL CHECK(json_valid(config)),
 encrypted_secret TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(tenant_id,owner_principal_id,id)
);
--> statement-breakpoint
INSERT INTO studio_collection_sources_mcp SELECT * FROM studio_collection_sources;
--> statement-breakpoint
DROP TABLE studio_collection_sources;
--> statement-breakpoint
ALTER TABLE studio_collection_sources_mcp RENAME TO studio_collection_sources;
--> statement-breakpoint
CREATE TABLE studio_mcp_oauth_flows (
 state TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 owner_principal_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 encrypted_flow TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX studio_mcp_oauth_flows_expiry ON studio_mcp_oauth_flows(expires_at);
