CREATE TABLE savia_core.tenant_whatsapp_connections (
  id TEXT NOT NULL,
  tenant_id BIGINT NOT NULL REFERENCES savia_core.tenants(id),
  created_by_principal_id TEXT NOT NULL REFERENCES savia_core.identity_principal(id),
  nango_connection_id TEXT NOT NULL,
  nango_integration_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = ANY (ARRAY['pending'::text, 'connected'::text, 'reconnect_required'::text, 'disconnected'::text, 'failed'::text])),
  phone_number_id TEXT,
  display_phone_number TEXT,
  waba_id TEXT,
  external_account_label TEXT,
  last_validated_at TEXT,
  disconnected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT tenant_whatsapp_connections_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX tenant_whatsapp_connections_tenant_active_unique
  ON savia_core.tenant_whatsapp_connections (tenant_id) WHERE disconnected_at IS NULL;
CREATE UNIQUE INDEX tenant_whatsapp_connections_nango_active_unique
  ON savia_core.tenant_whatsapp_connections (nango_integration_id, nango_connection_id) WHERE disconnected_at IS NULL;
CREATE INDEX tenant_whatsapp_connections_owner_index
  ON savia_core.tenant_whatsapp_connections (created_by_principal_id, tenant_id);
