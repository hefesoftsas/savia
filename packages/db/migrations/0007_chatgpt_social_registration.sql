CREATE TABLE social_registration_ledger_chatgpt (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  auth_subject TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('google','microsoft','chatgpt')),
  revision TEXT NOT NULL,
  principal_id TEXT NOT NULL UNIQUE REFERENCES identity_principal(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL UNIQUE REFERENCES identity_tenant_membership(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO social_registration_ledger_chatgpt (
  attempt_id,auth_subject,tenant_id,email,provider,revision,principal_id,membership_id,created_at
)
SELECT attempt_id,auth_subject,tenant_id,email,provider,revision,principal_id,membership_id,created_at
FROM social_registration_ledger;
--> statement-breakpoint
DROP TABLE social_registration_ledger;
--> statement-breakpoint
ALTER TABLE social_registration_ledger_chatgpt RENAME TO social_registration_ledger;
