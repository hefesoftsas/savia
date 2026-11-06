ALTER TABLE savia_core.tenant_bookings
  DROP CONSTRAINT IF EXISTS tenant_bookings_conference_provider_check;
--> statement-breakpoint
ALTER TABLE savia_core.tenant_bookings
  ADD CONSTRAINT tenant_bookings_conference_provider_check
  CHECK (conference_provider = ANY (ARRAY['google_meet'::text, 'teams'::text, 'jitsi'::text]));
