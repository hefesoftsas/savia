ALTER TABLE savia_core.tenant_whatsapp_assistant_bindings ADD COLUMN native_config TEXT NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(native_config::jsonb) = 'object');
ALTER TABLE savia_core.whatsapp_inbox ADD COLUMN input_payload TEXT CHECK (input_payload IS NULL OR jsonb_typeof(input_payload::jsonb) = 'object');
ALTER TABLE savia_core.whatsapp_inbox ADD COLUMN reply_payload TEXT CHECK (reply_payload IS NULL OR jsonb_typeof(reply_payload::jsonb) = 'object');
CREATE TABLE savia_core.whatsapp_native_outbox (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  tenant_id BIGINT NOT NULL REFERENCES savia_core.tenants(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES savia_core.tenant_whatsapp_connections(id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL,
  reply_payload TEXT NOT NULL CHECK (jsonb_typeof(reply_payload::jsonb) = 'object'),
  state TEXT NOT NULL CHECK (state IN ('responding','sent','failed')),
  outbound_message_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX whatsapp_native_outbox_tenant_created ON savia_core.whatsapp_native_outbox (tenant_id,created_at);
