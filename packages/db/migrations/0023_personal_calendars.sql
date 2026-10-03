CREATE TABLE personal_calendar_sources (
  id TEXT PRIMARY KEY NOT NULL,
  principal_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'import')),
  name TEXT NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('blue', 'emerald', 'violet', 'amber', 'rose', 'slate')),
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  time_zone TEXT NOT NULL,
  hostname TEXT,
  encrypted_payload TEXT NOT NULL,
  encrypted_validators TEXT,
  last_synced_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX personal_calendar_sources_principal_created
  ON personal_calendar_sources(principal_id, created_at);
--> statement-breakpoint
CREATE TABLE user_calendar_preferences (
  principal_id TEXT PRIMARY KEY NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  settings TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
