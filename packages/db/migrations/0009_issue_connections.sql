PRAGMA defer_foreign_keys = ON;
CREATE TABLE personal_integration_audit_events_issue_connections_data (
  `id` TEXT PRIMARY KEY NOT NULL,
  `connection_id` TEXT NOT NULL,
  `principal_id` TEXT NOT NULL,
  `provider` TEXT NOT NULL,
  `event_type` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `error_code` TEXT,
  `created_at` TEXT NOT NULL
);
INSERT INTO personal_integration_audit_events_issue_connections_data (
  id, connection_id, principal_id, provider, event_type, outcome, error_code, created_at
)
SELECT id, connection_id, principal_id, provider, event_type, outcome, error_code, created_at
FROM personal_integration_audit_events;
DROP TABLE personal_integration_audit_events;
CREATE TABLE personal_integration_connections_issue_connections (
  `id` TEXT PRIMARY KEY NOT NULL,
  `principal_id` TEXT NOT NULL,
  `provider` TEXT NOT NULL,
  `nango_connection_id` TEXT NOT NULL,
  `nango_integration_id` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `external_account_label` TEXT,
  `external_account_id` TEXT,
  `scopes` TEXT NOT NULL DEFAULT '[]',
  `last_validated_at` TEXT,
  `disconnected_at` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  FOREIGN KEY (`principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`provider` IN ('google_drive', 'gmail', 'google_calendar', 'outlook', 'onedrive_personal', 'onedrive_business', 'jira', 'linear')),
  CHECK (`status` IN ('pending', 'connected', 'reconnect_required', 'disconnected', 'failed'))
);
INSERT INTO personal_integration_connections_issue_connections (
  id, principal_id, provider, nango_connection_id, nango_integration_id, status,
  external_account_label, external_account_id, scopes, last_validated_at,
  disconnected_at, created_at, updated_at
)
SELECT
  id, principal_id, provider, nango_connection_id, nango_integration_id, status,
  external_account_label, external_account_id, scopes, last_validated_at,
  disconnected_at, created_at, updated_at
FROM personal_integration_connections;
DROP TABLE personal_integration_connections;
ALTER TABLE personal_integration_connections_issue_connections
  RENAME TO personal_integration_connections;
CREATE UNIQUE INDEX personal_integration_connections_active_unique
  ON personal_integration_connections (principal_id, provider)
  WHERE disconnected_at IS NULL;
CREATE INDEX personal_integration_connections_principal_provider_index
  ON personal_integration_connections (principal_id, provider);
CREATE TABLE personal_integration_audit_events (
  `id` TEXT PRIMARY KEY NOT NULL,
  `connection_id` TEXT NOT NULL,
  `principal_id` TEXT NOT NULL,
  `provider` TEXT NOT NULL,
  `event_type` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `error_code` TEXT,
  `created_at` TEXT NOT NULL,
  FOREIGN KEY (`connection_id`) REFERENCES `personal_integration_connections`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict
);
INSERT INTO personal_integration_audit_events (
  id, connection_id, principal_id, provider, event_type, outcome, error_code, created_at
)
SELECT id, connection_id, principal_id, provider, event_type, outcome, error_code, created_at
FROM personal_integration_audit_events_issue_connections_data;
DROP TABLE personal_integration_audit_events_issue_connections_data;
CREATE INDEX personal_integration_audit_events_connection_created_at_index
  ON personal_integration_audit_events (connection_id, created_at);
CREATE INDEX personal_integration_audit_events_principal_created_at_index
  ON personal_integration_audit_events (principal_id, created_at);
