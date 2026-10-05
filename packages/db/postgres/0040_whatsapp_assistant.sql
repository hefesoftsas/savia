CREATE TABLE savia_core.tenant_whatsapp_assistant_bindings (
  tenant_id BIGINT NOT NULL,
  connection_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  allowed_contacts TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT tenant_whatsapp_assistant_bindings_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT tenant_whatsapp_assistant_bindings_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES savia_core.tenants(id) ON DELETE CASCADE,
  CONSTRAINT tenant_whatsapp_assistant_bindings_connection_fk FOREIGN KEY (connection_id)
    REFERENCES savia_core.tenant_whatsapp_connections(id) ON DELETE CASCADE,
  CONSTRAINT tenant_whatsapp_assistant_bindings_employee_fk FOREIGN KEY (employee_id)
    REFERENCES savia_core.assistant_virtual_employees(id) ON DELETE CASCADE,
  CONSTRAINT tenant_whatsapp_assistant_bindings_updated_by_fk FOREIGN KEY (updated_by)
    REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT,
  CONSTRAINT tenant_whatsapp_assistant_bindings_enabled_check CHECK (enabled IN (0, 1)),
  CONSTRAINT tenant_whatsapp_assistant_bindings_contacts_check CHECK (jsonb_typeof(allowed_contacts::jsonb) = 'array')
);
CREATE UNIQUE INDEX tenant_whatsapp_assistant_bindings_connection_unique
  ON savia_core.tenant_whatsapp_assistant_bindings (connection_id);

CREATE TABLE savia_core.whatsapp_inbox (
  message_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  normalized_contact TEXT NOT NULL,
  message_text TEXT NOT NULL,
  provider_timestamp TEXT NOT NULL,
  tenant_id BIGINT NOT NULL,
  connection_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  generation_attempts INTEGER NOT NULL DEFAULT 0,
  retry_at TEXT,
  lease_token TEXT,
  lease_until TEXT,
  reply_text TEXT,
  send_started_at TEXT,
  outbound_message_id TEXT,
  delivery_status TEXT,
  delivery_rank INTEGER NOT NULL DEFAULT 0,
  delivery_error_codes TEXT NOT NULL DEFAULT '[]',
  failure_code TEXT,
  received_at TEXT NOT NULL,
  completed_at TEXT,
  CONSTRAINT whatsapp_inbox_pkey PRIMARY KEY (message_id),
  CONSTRAINT whatsapp_inbox_message_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES savia_core.tenants(id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_inbox_connection_fk FOREIGN KEY (connection_id)
    REFERENCES savia_core.tenant_whatsapp_connections(id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_inbox_state_check CHECK (state = ANY (ARRAY['pending'::text, 'generating'::text, 'responding'::text, 'completed'::text, 'failed'::text])),
  CONSTRAINT whatsapp_inbox_attempts_check CHECK (generation_attempts >= 0),
  CONSTRAINT whatsapp_inbox_delivery_rank_check CHECK (delivery_rank >= 0),
  CONSTRAINT whatsapp_inbox_errors_check CHECK (jsonb_typeof(delivery_error_codes::jsonb) = 'array'),
  CONSTRAINT whatsapp_inbox_outbound_unique UNIQUE (outbound_message_id)
);
CREATE INDEX whatsapp_inbox_pending_idx
  ON savia_core.whatsapp_inbox (state, retry_at, received_at);
CREATE INDEX whatsapp_inbox_contact_history_idx
  ON savia_core.whatsapp_inbox (connection_id, normalized_contact, state, received_at);
CREATE INDEX whatsapp_inbox_sender_idx
  ON savia_core.whatsapp_inbox (phone_number_id, waba_id, received_at);
CREATE UNIQUE INDEX whatsapp_inbox_active_contact_unique
  ON savia_core.whatsapp_inbox (connection_id, normalized_contact)
  WHERE state IN ('generating', 'responding');

CREATE TABLE savia_core.whatsapp_delivery_receipts (
  phone_number_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  delivery_rank INTEGER NOT NULL,
  error_code TEXT,
  updated_at TEXT NOT NULL,
  CONSTRAINT whatsapp_delivery_receipts_pkey PRIMARY KEY (phone_number_id, waba_id, message_id),
  CONSTRAINT whatsapp_delivery_receipts_status_check CHECK (status = ANY (ARRAY['sent'::text, 'delivered'::text, 'read'::text, 'failed'::text])),
  CONSTRAINT whatsapp_delivery_receipts_rank_check CHECK (delivery_rank >= 0)
);
CREATE INDEX whatsapp_delivery_receipts_message_idx
  ON savia_core.whatsapp_delivery_receipts (message_id);
