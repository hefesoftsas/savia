CREATE TABLE savia_core.savia_request_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('loading','ready')),
  response_status INTEGER,
  response_status_text TEXT,
  response_headers TEXT,
  response_body TEXT,
  created_at TEXT NOT NULL,
  retrieved_at TEXT,
  expires_at TEXT,
  lease_token TEXT,
  lease_until TEXT
);
CREATE INDEX savia_request_cache_expiry
  ON savia_core.savia_request_cache(expires_at);
CREATE INDEX savia_request_cache_lease
  ON savia_core.savia_request_cache(lease_until)
  WHERE state='loading';
