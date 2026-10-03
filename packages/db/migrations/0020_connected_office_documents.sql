CREATE TABLE `connected_office_document_operations` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` INTEGER NOT NULL REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  `owner_id` TEXT NOT NULL REFERENCES `identity_principal`(`id`) ON DELETE CASCADE,
  `request_id` TEXT NOT NULL,
  `request_hash` TEXT NOT NULL,
  `provider` TEXT NOT NULL CHECK (`provider` IN ('google_drive','onedrive_personal','onedrive_business')),
  `format` TEXT NOT NULL CHECK (`format` IN ('docx','xlsx','pptx')),
  `name` TEXT NOT NULL,
  `provider_file_id` TEXT,
  `provider_drive_id` TEXT,
  `nango_connection_id` TEXT NOT NULL,
  `url` TEXT,
  `state` TEXT NOT NULL CHECK (`state` IN ('pending','ready','failed')),
  `created_at` TEXT NOT NULL,
  UNIQUE (`tenant_id`,`owner_id`,`request_id`)
);
--> statement-breakpoint
CREATE INDEX `connected_office_documents_owner_created`
ON `connected_office_document_operations` (`tenant_id`,`owner_id`,`state`,`created_at` DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX `connected_office_documents_provider_file`
ON `connected_office_document_operations` (`tenant_id`,`owner_id`,`provider`,`provider_file_id`)
WHERE `provider_file_id` IS NOT NULL;
