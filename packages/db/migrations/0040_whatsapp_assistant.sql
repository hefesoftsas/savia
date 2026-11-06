CREATE TABLE tenant_whatsapp_assistant_bindings (
  tenant_id BIGINT PRIMARY KEY NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL UNIQUE REFERENCES tenant_whatsapp_connections(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES assistant_virtual_employees(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  allowed_contacts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_contacts) AND json_type(allowed_contacts) = 'array'),
  updated_by TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE whatsapp_inbox (
  message_id TEXT PRIMARY KEY NOT NULL,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  normalized_contact TEXT NOT NULL,
  message_text TEXT NOT NULL,
  provider_timestamp TEXT NOT NULL,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES tenant_whatsapp_connections(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'generating', 'responding', 'completed', 'failed')),
  generation_attempts INTEGER NOT NULL DEFAULT 0 CHECK (generation_attempts >= 0),
  retry_at TEXT,
  lease_token TEXT,
  lease_until TEXT,
  reply_text TEXT,
  send_started_at TEXT,
  outbound_message_id TEXT UNIQUE,
  delivery_status TEXT,
  delivery_rank INTEGER NOT NULL DEFAULT 0 CHECK (delivery_rank >= 0),
  delivery_error_codes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(delivery_error_codes) AND json_type(delivery_error_codes) = 'array'),
  failure_code TEXT,
  received_at TEXT NOT NULL,
  completed_at TEXT
);
--> statement-breakpoint
CREATE INDEX whatsapp_inbox_pending_idx ON whatsapp_inbox (state, retry_at, received_at);
--> statement-breakpoint
CREATE INDEX whatsapp_inbox_contact_history_idx ON whatsapp_inbox (connection_id, normalized_contact, state, received_at);
--> statement-breakpoint
CREATE INDEX whatsapp_inbox_sender_idx ON whatsapp_inbox (phone_number_id, waba_id, received_at);
--> statement-breakpoint
CREATE UNIQUE INDEX whatsapp_inbox_active_contact_unique
  ON whatsapp_inbox (connection_id, normalized_contact)
  WHERE state IN ('generating', 'responding');
--> statement-breakpoint
CREATE TABLE whatsapp_delivery_receipts (
  phone_number_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  delivery_rank INTEGER NOT NULL CHECK (delivery_rank >= 0),
  error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (phone_number_id, waba_id, message_id)
);
--> statement-breakpoint
CREATE INDEX whatsapp_delivery_receipts_message_idx ON whatsapp_delivery_receipts (message_id);
