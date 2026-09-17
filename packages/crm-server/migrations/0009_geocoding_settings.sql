CREATE TABLE IF NOT EXISTS crm_geocoding_settings (
  tenant_id TEXT PRIMARY KEY,
  encrypted_geoapify_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
