ALTER TABLE tenant_whatsapp_assistant_bindings ADD COLUMN native_config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(native_config) AND json_type(native_config) = 'object');
--> statement-breakpoint
ALTER TABLE whatsapp_inbox ADD COLUMN input_payload TEXT CHECK (input_payload IS NULL OR json_valid(input_payload));
--> statement-breakpoint
ALTER TABLE whatsapp_inbox ADD COLUMN reply_payload TEXT CHECK (reply_payload IS NULL OR json_valid(reply_payload));
--> statement-breakpoint
CREATE TABLE whatsapp_native_outbox (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES tenant_whatsapp_connections(id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL,
  reply_payload TEXT NOT NULL CHECK (json_valid(reply_payload)),
  state TEXT NOT NULL CHECK (state IN ('responding','sent','failed')),
  outbound_message_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
--> statement-breakpoint
CREATE INDEX whatsapp_native_outbox_tenant_created ON whatsapp_native_outbox (tenant_id,created_at);
