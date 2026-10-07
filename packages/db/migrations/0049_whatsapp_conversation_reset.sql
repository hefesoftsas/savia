ALTER TABLE whatsapp_channel_contacts ADD COLUMN reset_token_hash TEXT;
ALTER TABLE whatsapp_channel_contacts ADD COLUMN reset_expires_at TEXT;
ALTER TABLE whatsapp_channel_contacts ADD COLUMN reset_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE whatsapp_channel_contacts ADD COLUMN last_reset_message_id TEXT;
