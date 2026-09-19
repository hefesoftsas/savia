CREATE TABLE IF NOT EXISTS crm_studio_settings (
  tenant_id TEXT PRIMARY KEY,
  menu_layout TEXT CHECK(menu_layout IS NULL OR json_valid(menu_layout)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
