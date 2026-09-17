CREATE TABLE `attachment_uploads` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `domain` text NOT NULL,
  `collection` text NOT NULL,
  `aggregate_id` BIGINT NOT NULL,
  `object_key` text NOT NULL,
  `original_name` text NOT NULL,
  `content_type` text NOT NULL,
  `byte_size` integer NOT NULL,
  `sha256` text,
  `status` text NOT NULL,
  `source_table` text,
  `source_document_id` BIGINT,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE no action,
  CHECK (`status` IN ('issued', 'ready', 'rejected', 'discarded')),
  CHECK (`byte_size` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_uploads_object_key_unique` ON `attachment_uploads` (`object_key`);
--> statement-breakpoint
CREATE INDEX `attachment_uploads_target_index` ON `attachment_uploads` (`domain`, `collection`, `aggregate_id`);
--> statement-breakpoint
CREATE INDEX `attachment_uploads_agency_status_index` ON `attachment_uploads` (`agency_id`, `status`);
