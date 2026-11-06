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
    'zoom'::text
  ]));
CREATE TABLE savia_core.zoom_personal_meetings (
  principal_id TEXT NOT NULL REFERENCES savia_core.identity_principal(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES savia_core.personal_integration_connections(id),
  nango_connection_id TEXT NOT NULL,
  nango_integration_id TEXT NOT NULL,
  immutable_request TEXT,
  meeting_id TEXT,
  join_url TEXT,
  calendar_connection_id TEXT,
  calendar_nango_connection_id TEXT,
  calendar_nango_integration_id TEXT,
  calendar_provider TEXT CHECK(calendar_provider IN ('google_calendar', 'outlook')),
  calendar_event_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('creating', 'active', 'uncertain', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, resource_key)
);
CREATE INDEX zoom_personal_meetings_calendar_event_idx
  ON savia_core.zoom_personal_meetings (principal_id, calendar_provider, calendar_event_id);
