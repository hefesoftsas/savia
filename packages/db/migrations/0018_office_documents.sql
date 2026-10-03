CREATE TABLE `office_documents` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` INTEGER NOT NULL REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  `owner_id` TEXT NOT NULL REFERENCES `identity_principal`(`id`) ON DELETE CASCADE,
  `name` TEXT NOT NULL,
  `mime` TEXT NOT NULL,
  `size` INTEGER NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `storage_key` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX `office_documents_owner_updated`
ON `office_documents` (`tenant_id`, `owner_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `office_document_revisions` (
  `document_id` TEXT NOT NULL REFERENCES `office_documents`(`id`) ON DELETE CASCADE,
  `version` INTEGER NOT NULL,
  `storage_key` TEXT NOT NULL UNIQUE,
  `size` INTEGER NOT NULL,
  `created_at` TEXT NOT NULL,
  `created_by` TEXT REFERENCES `identity_principal`(`id`) ON DELETE SET NULL,
  PRIMARY KEY (`document_id`, `version`)
);
