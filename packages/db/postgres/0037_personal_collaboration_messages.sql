ALTER TABLE savia_core.personal_integration_connections
  DROP CONSTRAINT personal_integration_connections_provider_check;
ALTER TABLE savia_core.personal_integration_connections
  ADD CONSTRAINT personal_integration_connections_provider_check
  CHECK (provider = ANY (ARRAY[
    'google_drive'::text,
    'gmail'::text,
    'google_calendar'::text,
    'outlook'::text,
    'onedrive_personal'::text,
    'onedrive_business'::text,
    'jira'::text,
    'linear'::text,
    'github'::text,
    'zoom'::text,
    'slack'::text,
    'microsoft_teams'::text
  ]));
CREATE TABLE savia_core.personal_collaboration_messages (
  id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  state TEXT NOT NULL,
  message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT personal_collaboration_messages_pkey PRIMARY KEY (id),
  CONSTRAINT personal_collaboration_messages_principal_id_fkey
    FOREIGN KEY (principal_id)
    REFERENCES savia_core.identity_principal(id)
    ON DELETE CASCADE,
  CONSTRAINT personal_collaboration_messages_provider_check
    CHECK (provider = ANY (ARRAY['slack'::text, 'microsoft_teams'::text])),
  CONSTRAINT personal_collaboration_messages_state_check
    CHECK (state = ANY (ARRAY['sending'::text, 'sent'::text, 'ambiguous'::text])),
  CONSTRAINT personal_collaboration_messages_principal_id_request_id_key
    UNIQUE (principal_id, request_id)
);
CREATE INDEX personal_collaboration_messages_principal_created
  ON savia_core.personal_collaboration_messages (principal_id, created_at DESC);
