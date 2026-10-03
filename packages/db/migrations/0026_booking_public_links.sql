CREATE TABLE tenant_booking_public_links (id TEXT PRIMARY KEY, tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, created_by TEXT, token TEXT NOT NULL UNIQUE, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('team','professional')), professional_id TEXT, service_id TEXT, expires_at TEXT, revoked_at TEXT, daily_limit INTEGER NOT NULL DEFAULT 25 CHECK(daily_limit BETWEEN 1 AND 1000), version INTEGER NOT NULL DEFAULT 1, legacy INTEGER NOT NULL DEFAULT 0 CHECK(legacy IN (0,1)), CHECK((scope_kind='professional' AND professional_id IS NOT NULL) OR (scope_kind='team' AND professional_id IS NULL)));
--> statement-breakpoint
CREATE INDEX tenant_booking_public_links_tenant ON tenant_booking_public_links(tenant_id);
--> statement-breakpoint
INSERT INTO tenant_booking_public_links(id,tenant_id,token,scope_kind,legacy) SELECT public_token,tenant_id,public_token,'team',1 FROM tenant_booking_settings;
--> statement-breakpoint
CREATE TABLE tenant_booking_request_receipts (id TEXT PRIMARY KEY, link_id TEXT NOT NULL REFERENCES tenant_booking_public_links(id) ON DELETE CASCADE, tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, ip_hash TEXT NOT NULL, day TEXT NOT NULL, captcha_hash TEXT UNIQUE, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX tenant_booking_receipts_link_day ON tenant_booking_request_receipts(link_id,day);
--> statement-breakpoint
CREATE INDEX tenant_booking_receipts_tenant_day ON tenant_booking_request_receipts(tenant_id,day);
--> statement-breakpoint
CREATE INDEX tenant_booking_receipts_ip_day ON tenant_booking_request_receipts(ip_hash,day);
--> statement-breakpoint
ALTER TABLE tenant_bookings ADD COLUMN customer_locale TEXT NOT NULL DEFAULT 'en' CHECK(customer_locale IN ('en','es','pt'));
