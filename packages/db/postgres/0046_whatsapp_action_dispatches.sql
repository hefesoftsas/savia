CREATE TABLE savia_core.whatsapp_channel_dispatches (
  action_id TEXT NOT NULL REFERENCES savia_core.whatsapp_channel_actions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(action_id,product_id)
);
