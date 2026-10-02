ALTER TABLE savia_core.admin_oauth_transactions
    ADD COLUMN initiated_origin text;

CREATE TABLE savia_core.admin_oauth_session_origins (
    token_hash text NOT NULL,
    origin text NOT NULL,
    expires_at text NOT NULL,
    CONSTRAINT admin_oauth_session_origins_pkey PRIMARY KEY (token_hash)
);

CREATE INDEX admin_oauth_session_origins_expires_at_index
    ON savia_core.admin_oauth_session_origins USING btree (expires_at);
