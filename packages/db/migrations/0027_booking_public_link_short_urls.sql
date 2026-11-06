ALTER TABLE tenant_booking_public_links ADD COLUMN deleted_at TEXT;
--> statement-breakpoint
ALTER TABLE tenant_booking_public_links ADD COLUMN short_code TEXT;
--> statement-breakpoint
ALTER TABLE tenant_booking_public_links ADD COLUMN short_url TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX tenant_booking_public_links_short_code ON tenant_booking_public_links(short_code) WHERE short_code IS NOT NULL;
