CREATE TABLE IF NOT EXISTS crm_data_domains (
 id TEXT PRIMARY KEY NOT NULL,
 label TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
