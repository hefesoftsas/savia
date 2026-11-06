CREATE TABLE email_registration_ledger (
  attempt_id text PRIMARY KEY NOT NULL,
  auth_subject text NOT NULL UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  revision text NOT NULL,
  principal_id text NOT NULL UNIQUE REFERENCES identity_principal(id) ON DELETE CASCADE,
  membership_id text NOT NULL UNIQUE REFERENCES identity_tenant_membership(id) ON DELETE CASCADE,
  created_at text NOT NULL
);

CREATE TABLE email_registration_audit (
  id text PRIMARY KEY NOT NULL,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attempt_id text NOT NULL,
  event text NOT NULL CHECK (event = ANY (ARRAY['finalized'::text, 'rejected'::text, 'compensated'::text])),
  reason text,
  created_at text NOT NULL
);

CREATE INDEX email_registration_audit_tenant_created_index ON email_registration_audit USING btree (tenant_id, created_at);

CREATE TABLE email_registration_cancellation (
  attempt_id text PRIMARY KEY NOT NULL,
  cancelled integer NOT NULL DEFAULT 0 CHECK (cancelled IN (0,1)),
  created_at text NOT NULL
);

CREATE TABLE registration_captcha_consumption (
  proof_hash text PRIMARY KEY NOT NULL,
  request_id text NOT NULL UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','verified','accepted','failed')),
  expires_at bigint NOT NULL
);
CREATE INDEX registration_captcha_consumption_expiry_index ON registration_captcha_consumption USING btree (expires_at);
