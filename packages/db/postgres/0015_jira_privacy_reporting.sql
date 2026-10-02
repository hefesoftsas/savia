ALTER TABLE personal_integration_connections
  ADD COLUMN jira_privacy_generation TEXT;
--> statement-breakpoint
UPDATE personal_integration_connections
SET external_account_id = NULL, external_account_label = NULL
WHERE provider = 'jira' AND disconnected_at IS NOT NULL;
--> statement-breakpoint
CREATE TABLE jira_privacy_accounts (
  integration_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  oldest_data_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_reported_at TEXT,
  next_report_at TEXT NOT NULL,
  retry_at TEXT,
  lease_token TEXT,
  lease_until TEXT,
  pending_erasure TEXT,
  blocked_reason TEXT,
  PRIMARY KEY (integration_id, account_id),
  CHECK (version > 0),
  CHECK (pending_erasure IS NULL OR pending_erasure IN ('closed', 'updated')),
  CHECK (blocked_reason IS NULL OR blocked_reason IN ('unsupported-cycle', 'owner-auth-required'))
);
--> statement-breakpoint
CREATE TABLE jira_privacy_connections (
  generation TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT,
  principal_id TEXT,
  integration_id TEXT NOT NULL,
  nango_connection_id TEXT NOT NULL,
  account_id TEXT,
  retrieved_at TEXT NOT NULL,
  cleanup_reason TEXT,
  cleanup_retry_at TEXT,
  CHECK ((connection_id IS NULL AND principal_id IS NULL) OR (connection_id IS NOT NULL AND principal_id IS NOT NULL)),
  CHECK (cleanup_reason IS NULL OR cleanup_reason IN ('closed', 'updated', 'disconnect', 'replace'))
);
--> statement-breakpoint
CREATE TABLE jira_privacy_integrations (
  integration_id TEXT PRIMARY KEY NOT NULL,
  owner_authorization_required INTEGER NOT NULL DEFAULT 0,
  revoked_reporting_connection_id TEXT,
  cycle_blocked INTEGER NOT NULL DEFAULT 0,
  reporter_retry_at TEXT,
  CHECK (owner_authorization_required IN (0, 1)),
  CHECK (cycle_blocked IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX jira_privacy_connections_account_index
  ON jira_privacy_connections (integration_id, account_id);
--> statement-breakpoint
CREATE UNIQUE INDEX jira_privacy_connections_nango_unique
  ON jira_privacy_connections (integration_id, nango_connection_id);
CREATE INDEX jira_privacy_accounts_due_index
  ON jira_privacy_accounts (integration_id, next_report_at, retry_at);
