ALTER TABLE savia_core.tenant_bookings ADD COLUMN conference_provider TEXT CHECK(conference_provider IN ('google_meet','teams'));
ALTER TABLE savia_core.tenant_bookings ADD COLUMN conference_url TEXT;
ALTER TABLE savia_core.tenant_bookings ADD COLUMN conference_status TEXT CHECK(conference_status IN ('ready','pending','unsupported','failed'));
