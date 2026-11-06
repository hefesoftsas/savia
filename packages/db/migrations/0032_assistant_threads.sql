CREATE TABLE IF NOT EXISTS assistant_threads (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES identity_principal(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  messages TEXT NOT NULL CHECK (json_valid(messages)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  context_kind TEXT CHECK (context_kind IN ('recording', 'session')),
  context_id TEXT,
  context_title TEXT,
  CHECK ((context_kind IS NULL AND context_id IS NULL AND context_title IS NULL)
      OR (context_kind IS NOT NULL AND context_id IS NOT NULL AND context_title IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS assistant_threads_user_updated
  ON assistant_threads(user_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS assistant_threads_owner_context
  ON assistant_threads(user_id, context_kind, context_id)
  WHERE context_kind IS NOT NULL;
