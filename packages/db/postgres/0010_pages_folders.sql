ALTER TABLE pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'page'
  CHECK (kind IN ('page', 'folder'));
