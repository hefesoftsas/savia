CREATE TABLE whatsapp_channel_action_progress (
  id TEXT PRIMARY KEY NOT NULL,
  action_id TEXT NOT NULL REFERENCES whatsapp_channel_actions(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  progress_text TEXT NOT NULL CHECK (length(progress_text) > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','uncertain','history_pending','revoked','expired')),
  created_at TEXT NOT NULL,
  retry_at TEXT,
  lease_until TEXT,
  lease_token TEXT,
  outbound_message_id TEXT,
  delivery_text TEXT,
  delivery_at TEXT,
  UNIQUE(action_id,event_key)
);
--> statement-breakpoint
CREATE INDEX whatsapp_action_progress_pending
  ON whatsapp_channel_action_progress(status,retry_at,created_at,action_id);
--> statement-breakpoint
CREATE INDEX whatsapp_action_progress_action
  ON whatsapp_channel_action_progress(action_id,status,created_at);
--> statement-breakpoint
CREATE INDEX whatsapp_action_progress_expired_lease
  ON whatsapp_channel_action_progress(lease_until)
  WHERE status='sending';
