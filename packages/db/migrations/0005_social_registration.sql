CREATE TABLE social_registration_ledger (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  auth_subject TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
  revision TEXT NOT NULL,
  principal_id TEXT NOT NULL UNIQUE REFERENCES identity_principal(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL UNIQUE REFERENCES identity_tenant_membership(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE social_registration_audit (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('finalized','rejected','compensated')),
  reason TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX social_registration_audit_tenant_created_index ON social_registration_audit(tenant_id,created_at);
