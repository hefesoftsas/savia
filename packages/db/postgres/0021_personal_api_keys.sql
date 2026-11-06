CREATE TABLE savia_core.personal_api_keys (
 id TEXT PRIMARY KEY NOT NULL,
 principal_id TEXT NOT NULL REFERENCES savia_core.identity_principal(id) ON DELETE CASCADE,
 tenant_id BIGINT NOT NULL REFERENCES savia_core.tenants(id) ON DELETE CASCADE,
 deployment_id TEXT NOT NULL,
 name TEXT NOT NULL,
 prefix TEXT NOT NULL,
 secret_digest TEXT NOT NULL UNIQUE,
 scopes TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 last_used_at TEXT
);
CREATE INDEX personal_api_keys_owner ON savia_core.personal_api_keys(principal_id, expires_at);
