ALTER TABLE tenant_booking_calendar_grants ADD COLUMN conference_provider TEXT NOT NULL DEFAULT 'auto' CHECK(conference_provider IN ('auto','zoom'));
--> statement-breakpoint
ALTER TABLE tenant_booking_calendar_grants ADD COLUMN zoom_connection_id TEXT;
--> statement-breakpoint
ALTER TABLE tenant_bookings ADD COLUMN zoom_connection_id TEXT;
