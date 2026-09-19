-- Native PostgreSQL baseline; frozen final SQLite schema inventory is in manifest.json.
-- JSON stays text and integer flags retain the application API representation.


CREATE FUNCTION savia_json_valid(value text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN PERFORM value::json; RETURN value IS NOT NULL;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;

CREATE TABLE flows (id TEXT PRIMARY KEY, definition TEXT NOT NULL);

CREATE TABLE flow_versions (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, definition TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE flow_variables (flow_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, secret BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(flow_id, key));

CREATE TABLE flow_runs (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, version_id TEXT, mode TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, summary TEXT NOT NULL);

CREATE TABLE folders (path TEXT PRIMARY KEY);

CREATE TABLE installed_bundles (id TEXT PRIMARY KEY, version TEXT NOT NULL, installed_at TEXT NOT NULL);
