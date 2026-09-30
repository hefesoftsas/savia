CREATE TABLE email_registration_ledger (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  auth_subject TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  revision TEXT NOT NULL,
  principal_id TEXT NOT NULL UNIQUE REFERENCES identity_principal(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL UNIQUE REFERENCES identity_tenant_membership(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE email_registration_audit (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('finalized','rejected','compensated')),
  reason TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX email_registration_audit_tenant_created_index ON email_registration_audit(tenant_id,created_at);
--> statement-breakpoint
CREATE TABLE email_registration_cancellation (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1)),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE registration_captcha_consumption (
  proof_hash TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','verified','accepted','failed')),
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX registration_captcha_consumption_expiry_index ON registration_captcha_consumption(expires_at);
