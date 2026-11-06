ALTER TABLE tenant_bookings ADD COLUMN conference_provider TEXT CHECK(conference_provider IN ('google_meet','teams'));
--> statement-breakpoint
ALTER TABLE tenant_bookings ADD COLUMN conference_url TEXT;
--> statement-breakpoint
ALTER TABLE tenant_bookings ADD COLUMN conference_status TEXT CHECK(conference_status IN ('ready','pending','unsupported','failed'));
