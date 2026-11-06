CREATE TABLE personal_ticket_summary_cache (
  principal_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  jira_connection_id TEXT NOT NULL REFERENCES personal_integration_connections(id) ON DELETE CASCADE,
  github_connection_id TEXT REFERENCES personal_integration_connections(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_id, cache_key)
);
CREATE INDEX personal_ticket_summary_cache_updated_at_index
  ON personal_ticket_summary_cache (principal_id, updated_at DESC);
CREATE FUNCTION purge_personal_ticket_summary_cache_on_connection_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.principal_id IS DISTINCT FROM NEW.principal_id
    OR OLD.provider IS DISTINCT FROM NEW.provider
    OR OLD.nango_connection_id IS DISTINCT FROM NEW.nango_connection_id
    OR OLD.nango_integration_id IS DISTINCT FROM NEW.nango_integration_id
    OR OLD.external_account_id IS DISTINCT FROM NEW.external_account_id
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.disconnected_at IS DISTINCT FROM NEW.disconnected_at
    OR OLD.scopes IS DISTINCT FROM NEW.scopes
    OR OLD.jira_privacy_generation IS DISTINCT FROM NEW.jira_privacy_generation THEN
    DELETE FROM personal_ticket_summary_cache
    WHERE jira_connection_id = OLD.id OR github_connection_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER personal_ticket_summary_cache_purge_connection_update
AFTER UPDATE OF principal_id, provider, nango_connection_id, nango_integration_id,
  external_account_id, status, disconnected_at, scopes, jira_privacy_generation
ON personal_integration_connections
FOR EACH ROW EXECUTE FUNCTION purge_personal_ticket_summary_cache_on_connection_change();
