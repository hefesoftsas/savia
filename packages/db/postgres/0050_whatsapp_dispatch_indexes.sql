CREATE INDEX whatsapp_inbox_dispatch_scope
  ON savia_core.whatsapp_inbox(connection_id, normalized_contact, received_at, message_id)
  WHERE state IN ('pending', 'generating', 'responding');

CREATE INDEX whatsapp_action_dispatch_scope
  ON savia_core.whatsapp_channel_actions(connection_id, contact, status, queued_at, created_at);

CREATE INDEX whatsapp_action_delivery_scope
  ON savia_core.whatsapp_channel_actions(connection_id, contact, created_at)
  WHERE status IN ('completed', 'failed', 'uncertain')
    AND (delivery_state IS NULL OR delivery_state = 'history_pending');

CREATE INDEX whatsapp_action_unfinished_scope
  ON savia_core.whatsapp_channel_actions(connection_id, contact)
  WHERE status IN ('queued', 'dispatching')
    OR (status IN ('completed', 'failed', 'uncertain')
      AND (delivery_state IS NULL OR delivery_state IN ('history_pending', 'sending')));
