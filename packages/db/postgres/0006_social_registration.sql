CREATE TABLE social_registration_ledger (
  attempt_id text PRIMARY KEY NOT NULL,
  auth_subject text NOT NULL UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  provider text NOT NULL CHECK (provider = ANY (ARRAY['google'::text, 'microsoft'::text])),
  revision text NOT NULL,
  principal_id text NOT NULL UNIQUE REFERENCES identity_principal(id) ON DELETE CASCADE,
  membership_id text NOT NULL UNIQUE REFERENCES identity_tenant_membership(id) ON DELETE CASCADE,
  created_at text NOT NULL
);

CREATE TABLE social_registration_audit (
  id text PRIMARY KEY NOT NULL,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attempt_id text NOT NULL,
  event text NOT NULL CHECK (event = ANY (ARRAY['finalized'::text, 'rejected'::text, 'compensated'::text])),
  reason text,
  created_at text NOT NULL
);

CREATE INDEX social_registration_audit_tenant_created_index ON social_registration_audit USING btree (tenant_id, created_at);
