ALTER TABLE savia_core.tenant_booking_public_links ADD COLUMN deleted_at TEXT;
ALTER TABLE savia_core.tenant_booking_public_links ADD COLUMN short_code TEXT;
ALTER TABLE savia_core.tenant_booking_public_links ADD COLUMN short_url TEXT;
CREATE UNIQUE INDEX tenant_booking_public_links_short_code ON savia_core.tenant_booking_public_links(short_code) WHERE short_code IS NOT NULL;
