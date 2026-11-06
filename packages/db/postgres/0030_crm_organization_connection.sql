-- A reconnect-required, pending, or failed connection still owns its slot.
-- Existing duplicate organizations must be explicitly disconnected before applying
-- this migration. Never silently choose an account or revoke provider credentials.
CREATE UNIQUE INDEX tenant_crm_connections_organization_active_unique
  ON savia_core.tenant_crm_connections (tenant_id) WHERE disconnected_at IS NULL;
--> statement-breakpoint
-- A remote credential must not be revoked by disconnecting another organization.
CREATE UNIQUE INDEX tenant_crm_connections_nango_active_unique
  ON savia_core.tenant_crm_connections (nango_integration_id, nango_connection_id)
  WHERE disconnected_at IS NULL;
