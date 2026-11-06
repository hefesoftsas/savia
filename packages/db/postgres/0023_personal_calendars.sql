CREATE TABLE savia_core.personal_calendar_sources (
  id TEXT PRIMARY KEY NOT NULL,
  principal_id TEXT NOT NULL REFERENCES savia_core.identity_principal(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'import')),
  name TEXT NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('blue', 'emerald', 'violet', 'amber', 'rose', 'slate')),
  visible BIGINT NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  time_zone TEXT NOT NULL,
  hostname TEXT,
  encrypted_payload TEXT NOT NULL,
  encrypted_validators TEXT,
  last_synced_at TEXT,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX personal_calendar_sources_principal_created
  ON savia_core.personal_calendar_sources(principal_id, created_at);
CREATE TABLE savia_core.user_calendar_preferences (
  principal_id TEXT PRIMARY KEY NOT NULL REFERENCES savia_core.identity_principal(id) ON DELETE CASCADE,
  settings TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
