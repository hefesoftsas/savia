ALTER TABLE whatsapp_inbox ADD COLUMN assigned_employee_id TEXT;
--> statement-breakpoint
ALTER TABLE whatsapp_inbox ADD COLUMN assigned_owner_principal_id TEXT;
--> statement-breakpoint
DROP INDEX whatsapp_inbox_contact_history_idx;
--> statement-breakpoint
CREATE INDEX whatsapp_inbox_contact_history_idx
  ON whatsapp_inbox (
    connection_id,phone_number_id,waba_id,normalized_contact,
    assigned_employee_id,assigned_owner_principal_id,state,received_at
  );
--> statement-breakpoint
ALTER TABLE whatsapp_native_outbox ADD COLUMN phone_number_id TEXT;
--> statement-breakpoint
ALTER TABLE whatsapp_native_outbox ADD COLUMN waba_id TEXT;
--> statement-breakpoint
ALTER TABLE whatsapp_native_outbox ADD COLUMN assigned_employee_id TEXT;
--> statement-breakpoint
ALTER TABLE whatsapp_native_outbox ADD COLUMN assigned_owner_principal_id TEXT;
