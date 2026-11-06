CREATE TABLE IF NOT EXISTS savia_flows_cost_maintenance (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  completed_day TEXT
);
