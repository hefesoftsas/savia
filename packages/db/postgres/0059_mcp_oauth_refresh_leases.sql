CREATE TABLE savia_core.studio_mcp_oauth_refresh_leases (
  tenant_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_expires_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id,owner_principal_id,source_id)
);
--> statement-breakpoint
CREATE INDEX studio_mcp_oauth_refresh_leases_expiry
  ON savia_core.studio_mcp_oauth_refresh_leases(lease_expires_at);
