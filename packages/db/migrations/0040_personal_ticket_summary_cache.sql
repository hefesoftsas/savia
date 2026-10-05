CREATE TABLE personal_ticket_summary_cache (
  principal_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  jira_connection_id TEXT NOT NULL REFERENCES personal_integration_connections(id) ON DELETE CASCADE,
  github_connection_id TEXT REFERENCES personal_integration_connections(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, cache_key)
);
--> statement-breakpoint
CREATE INDEX personal_ticket_summary_cache_updated_at_index
  ON personal_ticket_summary_cache (principal_id, updated_at DESC);
--> statement-breakpoint
CREATE TRIGGER personal_ticket_summary_cache_purge_connection_update
AFTER UPDATE OF principal_id, provider, nango_connection_id, nango_integration_id,
  external_account_id,
  status, disconnected_at, scopes, jira_privacy_generation
ON personal_integration_connections
WHEN OLD.principal_id IS NOT NEW.principal_id
  OR OLD.provider IS NOT NEW.provider
  OR OLD.nango_connection_id IS NOT NEW.nango_connection_id
  OR OLD.nango_integration_id IS NOT NEW.nango_integration_id
  OR OLD.external_account_id IS NOT NEW.external_account_id
  OR OLD.status IS NOT NEW.status
  OR OLD.disconnected_at IS NOT NEW.disconnected_at
  OR OLD.scopes IS NOT NEW.scopes
  OR OLD.jira_privacy_generation IS NOT NEW.jira_privacy_generation
BEGIN
  DELETE FROM personal_ticket_summary_cache
  WHERE jira_connection_id = OLD.id OR github_connection_id = OLD.id;
END;
