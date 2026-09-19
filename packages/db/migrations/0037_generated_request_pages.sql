CREATE TABLE request_page_runs (
  id TEXT PRIMARY KEY NOT NULL,
  principal_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  action_id TEXT NOT NULL,
  action_label TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('mock', 'live')),
  status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'failed')),
  form_values TEXT NOT NULL,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX request_page_runs_owner_page ON request_page_runs(principal_id,domain_id,page_name,created_at);
