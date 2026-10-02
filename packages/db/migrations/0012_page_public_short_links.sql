ALTER TABLE page_public_links ADD COLUMN short_url TEXT;
--> statement-breakpoint
CREATE TABLE page_public_short_links (
  code TEXT PRIMARY KEY NOT NULL CHECK(length(code) = 24 AND code NOT GLOB '*[^a-f0-9]*'),
  link_id TEXT NOT NULL UNIQUE REFERENCES page_public_links(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
