CREATE TABLE whatsapp_channel_settings (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES tenant_whatsapp_connections(id) ON DELETE CASCADE,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  revision TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE whatsapp_channel_contacts (
  connection_id TEXT NOT NULL REFERENCES tenant_whatsapp_connections(id) ON DELETE CASCADE,
  contact TEXT NOT NULL,
  generation TEXT NOT NULL,
  employee_id TEXT,
  selection_revision INTEGER NOT NULL DEFAULT 0,
  menu_json TEXT,
  buffered_text TEXT,
  draft_json TEXT,
  PRIMARY KEY(connection_id, contact)
);
--> statement-breakpoint
CREATE TABLE whatsapp_channel_history (
  message_id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES tenant_whatsapp_connections(id) ON DELETE CASCADE,
  contact TEXT NOT NULL,
  generation TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  user_text TEXT NOT NULL,
  assistant_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX whatsapp_channel_history_scope ON whatsapp_channel_history(connection_id,contact,generation,employee_id,created_at);
--> statement-breakpoint
CREATE TABLE whatsapp_channel_actions (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES tenant_whatsapp_connections(id) ON DELETE CASCADE,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact TEXT NOT NULL,
  generation TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  selection_revision INTEGER NOT NULL,
  action_json TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','queued','dispatching','completed','failed','uncertain','cancelled','expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result_json TEXT,
  outbound_message_id TEXT,
  delivery_state TEXT,
  lease_token TEXT,
  lease_until TEXT
);
--> statement-breakpoint
CREATE INDEX whatsapp_channel_action_jobs ON whatsapp_channel_actions(status,created_at);
--> statement-breakpoint
CREATE TABLE whatsapp_channel_resources (
  connection_id TEXT NOT NULL REFERENCES tenant_whatsapp_connections(id) ON DELETE CASCADE,
  contact TEXT NOT NULL,
  generation TEXT NOT NULL,
  solution_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  PRIMARY KEY(connection_id,contact,generation,solution_id,resource_type,resource_id)
);
