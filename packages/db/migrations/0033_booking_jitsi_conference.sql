CREATE TABLE tenant_bookings_jitsi_backup AS SELECT * FROM tenant_bookings;
--> statement-breakpoint
CREATE TABLE tenant_booking_occupancy_jitsi_backup AS SELECT * FROM tenant_booking_occupancy;
--> statement-breakpoint
CREATE TABLE tenant_booking_jobs_jitsi_backup AS SELECT * FROM tenant_booking_jobs;
--> statement-breakpoint
CREATE TABLE tenant_booking_delivery_locks_jitsi_backup AS SELECT * FROM tenant_booking_delivery_locks;
--> statement-breakpoint
DROP TABLE tenant_booking_occupancy;
--> statement-breakpoint
DROP TABLE tenant_booking_jobs;
--> statement-breakpoint
DROP TABLE tenant_booking_delivery_locks;
--> statement-breakpoint
DROP TABLE tenant_bookings;
--> statement-breakpoint
CREATE TABLE tenant_bookings (id TEXT PRIMARY KEY, tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, professional_id TEXT NOT NULL, principal_id TEXT NOT NULL, service_id TEXT NOT NULL, service_name TEXT NOT NULL, professional_name TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, buffer_minutes INTEGER NOT NULL, customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, manage_token TEXT NOT NULL UNIQUE, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')), version INTEGER NOT NULL DEFAULT 1, calendar_provider TEXT, calendar_connection_id TEXT, external_id TEXT, created_at TEXT NOT NULL, customer_locale TEXT NOT NULL DEFAULT 'en' CHECK(customer_locale IN ('en','es','pt')), conference_provider TEXT CHECK(conference_provider IN ('google_meet','teams','jitsi')), conference_url TEXT, conference_status TEXT CHECK(conference_status IN ('ready','pending','unsupported','failed')), UNIQUE(tenant_id,id), UNIQUE(tenant_id,request_key));
--> statement-breakpoint
INSERT INTO tenant_bookings SELECT * FROM tenant_bookings_jitsi_backup;
--> statement-breakpoint
CREATE INDEX tenant_bookings_agenda ON tenant_bookings(tenant_id,principal_id,starts_at);
--> statement-breakpoint
CREATE TABLE tenant_booking_occupancy (tenant_id BIGINT NOT NULL, principal_id TEXT NOT NULL, minute BIGINT NOT NULL, booking_id TEXT NOT NULL, PRIMARY KEY(tenant_id,principal_id,minute), FOREIGN KEY(tenant_id,booking_id) REFERENCES tenant_bookings(tenant_id,id) ON DELETE CASCADE);
--> statement-breakpoint
INSERT INTO tenant_booking_occupancy SELECT * FROM tenant_booking_occupancy_jitsi_backup;
--> statement-breakpoint
CREATE TABLE tenant_booking_jobs (id TEXT PRIMARY KEY, tenant_id BIGINT NOT NULL, booking_id TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('confirmation','change','cancellation','reminder','calendar')), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed','skipped')), attempts INTEGER NOT NULL DEFAULT 0, due_at BIGINT NOT NULL, lease_until BIGINT, lease_token TEXT, error_code TEXT, UNIQUE(tenant_id,booking_id,revision,kind), FOREIGN KEY(tenant_id,booking_id) REFERENCES tenant_bookings(tenant_id,id) ON DELETE CASCADE);
--> statement-breakpoint
INSERT INTO tenant_booking_jobs SELECT * FROM tenant_booking_jobs_jitsi_backup;
--> statement-breakpoint
CREATE INDEX tenant_booking_jobs_due ON tenant_booking_jobs(status,due_at);
--> statement-breakpoint
CREATE TABLE tenant_booking_delivery_locks (tenant_id BIGINT NOT NULL, booking_id TEXT NOT NULL, lease_until BIGINT NOT NULL, lease_token TEXT NOT NULL, PRIMARY KEY(tenant_id,booking_id), FOREIGN KEY(tenant_id,booking_id) REFERENCES tenant_bookings(tenant_id,id) ON DELETE CASCADE);
--> statement-breakpoint
INSERT INTO tenant_booking_delivery_locks SELECT * FROM tenant_booking_delivery_locks_jitsi_backup;
--> statement-breakpoint
DROP TABLE tenant_bookings_jitsi_backup;
--> statement-breakpoint
DROP TABLE tenant_booking_occupancy_jitsi_backup;
--> statement-breakpoint
DROP TABLE tenant_booking_jobs_jitsi_backup;
--> statement-breakpoint
DROP TABLE tenant_booking_delivery_locks_jitsi_backup;
