CREATE TABLE savia_core.studio_plugin_monitor_checks (
  tenant_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  next_check_at BIGINT NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at BIGINT NOT NULL DEFAULT 0,
  observation TEXT CHECK (observation IS NULL OR savia_core.savia_json_valid(observation)),
  error_code TEXT,
  error_sequence BIGINT NOT NULL DEFAULT 0,
  last_checked_at BIGINT,
  PRIMARY KEY (tenant_id,extension_id,monitor_id,record_id),
  FOREIGN KEY (tenant_id,record_id)
    REFERENCES savia_core.studio_records(tenant_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX studio_plugin_monitor_due
  ON savia_core.studio_plugin_monitor_checks(next_check_at,lease_expires_at);
--> statement-breakpoint
CREATE TABLE savia_core.studio_plugin_monitor_cursor (
  id TEXT PRIMARY KEY,
  after_tenant TEXT NOT NULL,
  after_extension TEXT NOT NULL
);
