ALTER TABLE savia_core.tenant_booking_calendar_grants ADD COLUMN conference_provider TEXT NOT NULL DEFAULT 'auto' CHECK(conference_provider IN ('auto','zoom'));
ALTER TABLE savia_core.tenant_booking_calendar_grants ADD COLUMN zoom_connection_id TEXT;
ALTER TABLE savia_core.tenant_bookings ADD COLUMN zoom_connection_id TEXT;
