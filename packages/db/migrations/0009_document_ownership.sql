CREATE TABLE `document_ownership` (
  `domain` TEXT NOT NULL,
  `collection` TEXT NOT NULL,
  `document_id` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  PRIMARY KEY (`domain`, `collection`, `document_id`),
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `document_ownership_agency_index`
  ON `document_ownership` (`agency_id`, `domain`, `collection`);
