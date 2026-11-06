ALTER TABLE social_registration_ledger
  DROP CONSTRAINT social_registration_ledger_provider_check;
--> statement-breakpoint
ALTER TABLE social_registration_ledger
  ADD CONSTRAINT social_registration_ledger_provider_check
  CHECK (provider = ANY (ARRAY['google'::text, 'microsoft'::text, 'chatgpt'::text]));
