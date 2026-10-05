CREATE TABLE tenant_whatsapp_connections (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  created_by_principal_id TEXT NOT NULL REFERENCES identity_principal(id),
  nango_connection_id TEXT NOT NULL,
  nango_integration_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','connected','reconnect_required','disconnected','failed')),
  phone_number_id TEXT,
  display_phone_number TEXT,
  waba_id TEXT,
  external_account_label TEXT,
  last_validated_at TEXT,
  disconnected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX tenant_whatsapp_connections_tenant_active_unique
  ON tenant_whatsapp_connections (tenant_id) WHERE disconnected_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX tenant_whatsapp_connections_nango_active_unique
  ON tenant_whatsapp_connections (nango_integration_id, nango_connection_id) WHERE disconnected_at IS NULL;
--> statement-breakpoint
CREATE INDEX tenant_whatsapp_connections_owner_index
  ON tenant_whatsapp_connections (created_by_principal_id, tenant_id);
