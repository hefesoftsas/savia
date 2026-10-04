PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE zoom_personal_meetings_collaboration_backup AS
SELECT principal_id, resource_key, connection_id, nango_connection_id,
  nango_integration_id, immutable_request, meeting_id, join_url,
  calendar_connection_id, calendar_nango_connection_id,
  calendar_nango_integration_id, calendar_provider, calendar_event_id,
  state, created_at, updated_at
FROM zoom_personal_meetings;
--> statement-breakpoint
DROP TABLE zoom_personal_meetings;
--> statement-breakpoint
CREATE TABLE personal_integration_audit_events_collaboration_backup AS
SELECT id, connection_id, principal_id, provider, event_type, outcome, error_code, created_at
FROM personal_integration_audit_events;
--> statement-breakpoint
DROP TABLE personal_integration_audit_events;
--> statement-breakpoint
CREATE TABLE personal_integration_connections_collaboration (
  id TEXT PRIMARY KEY NOT NULL,
  principal_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  nango_connection_id TEXT NOT NULL,
  nango_integration_id TEXT NOT NULL,
  status TEXT NOT NULL,
  external_account_label TEXT,
  external_account_id TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  last_validated_at TEXT,
  disconnected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  jira_privacy_generation TEXT,
  FOREIGN KEY (principal_id) REFERENCES identity_principal(id),
  CHECK (provider IN ('google_drive','gmail','google_calendar','outlook','onedrive_personal','onedrive_business','jira','linear','github','zoom','slack','microsoft_teams')),
  CHECK (status IN ('pending','connected','reconnect_required','disconnected','failed'))
);
--> statement-breakpoint
INSERT INTO personal_integration_connections_collaboration (
  id, principal_id, provider, nango_connection_id, nango_integration_id, status,
  external_account_label, external_account_id, scopes, last_validated_at,
  disconnected_at, created_at, updated_at, jira_privacy_generation
)
SELECT id, principal_id, provider, nango_connection_id, nango_integration_id, status,
  external_account_label, external_account_id, scopes, last_validated_at,
  disconnected_at, created_at, updated_at, jira_privacy_generation
FROM personal_integration_connections;
--> statement-breakpoint
DROP TABLE personal_integration_connections;
--> statement-breakpoint
ALTER TABLE personal_integration_connections_collaboration RENAME TO personal_integration_connections;
--> statement-breakpoint
CREATE TABLE zoom_personal_meetings (
  principal_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES personal_integration_connections(id),
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
--> statement-breakpoint
INSERT INTO zoom_personal_meetings (
  principal_id, resource_key, connection_id, nango_connection_id,
  nango_integration_id, immutable_request, meeting_id, join_url,
  calendar_connection_id, calendar_nango_connection_id,
  calendar_nango_integration_id, calendar_provider, calendar_event_id,
  state, created_at, updated_at
)
SELECT principal_id, resource_key, connection_id, nango_connection_id,
  nango_integration_id, immutable_request, meeting_id, join_url,
  calendar_connection_id, calendar_nango_connection_id,
  calendar_nango_integration_id, calendar_provider, calendar_event_id,
  state, created_at, updated_at
FROM zoom_personal_meetings_collaboration_backup;
--> statement-breakpoint
DROP TABLE zoom_personal_meetings_collaboration_backup;
--> statement-breakpoint
CREATE INDEX zoom_personal_meetings_calendar_event_idx
ON zoom_personal_meetings(principal_id, calendar_provider, calendar_event_id);
--> statement-breakpoint
CREATE UNIQUE INDEX personal_integration_connections_active_unique
ON personal_integration_connections (principal_id, provider) WHERE disconnected_at IS NULL;
--> statement-breakpoint
CREATE INDEX personal_integration_connections_principal_provider_index
ON personal_integration_connections (principal_id, provider);
--> statement-breakpoint
CREATE TABLE personal_integration_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES personal_integration_connections(id),
  FOREIGN KEY (principal_id) REFERENCES identity_principal(id)
);
--> statement-breakpoint
INSERT INTO personal_integration_audit_events
SELECT id, connection_id, principal_id, provider, event_type, outcome, error_code, created_at
FROM personal_integration_audit_events_collaboration_backup;
--> statement-breakpoint
DROP TABLE personal_integration_audit_events_collaboration_backup;
--> statement-breakpoint
CREATE INDEX personal_integration_audit_events_connection_created_at_index
ON personal_integration_audit_events (connection_id, created_at);
--> statement-breakpoint
CREATE INDEX personal_integration_audit_events_principal_created_at_index
ON personal_integration_audit_events (principal_id, created_at);
--> statement-breakpoint
CREATE TABLE personal_collaboration_messages (
  id TEXT PRIMARY KEY NOT NULL,
  principal_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('slack','microsoft_teams')),
  state TEXT NOT NULL CHECK (state IN ('sending','sent','ambiguous')),
  message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (principal_id, request_id)
);
--> statement-breakpoint
CREATE INDEX personal_collaboration_messages_principal_created
ON personal_collaboration_messages (principal_id, created_at DESC);
