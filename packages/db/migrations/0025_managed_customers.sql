CREATE TABLE managed_customer_extensions (
  tenant_id TEXT NOT NULL,
  profile_id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,profile_id),
  FOREIGN KEY(profile_id) REFERENCES customer_clientagency(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE managed_customer_requests (
  tenant_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response TEXT NOT NULL CHECK(json_valid(response)),
  PRIMARY KEY(tenant_id,request_key)
);
