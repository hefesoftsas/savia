CREATE TABLE `auto_light_quote_requests` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `created_by_principal_id` TEXT NOT NULL,
  `plate` TEXT NOT NULL,
  `vehicle_source` TEXT NOT NULL,
  `vehicle_snapshot` TEXT NOT NULL,
  `applicant_snapshot` TEXT NOT NULL,
  `coverage_preferences` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`created_by_principal_id`) REFERENCES `identity_principal`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`vehicle_source` IN ('equidad', 'sura')),
  CHECK (`status` IN ('pending', 'in_progress', 'successful', 'partial', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `auto_light_quote_requests_agency_created_at_index`
  ON `auto_light_quote_requests` (`agency_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `auto_light_quote_offers` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `quote_request_id` TEXT NOT NULL,
  `provider` TEXT NOT NULL,
  `operation_id` TEXT NOT NULL,
  `attempt_number` INTEGER NOT NULL,
  `status` TEXT NOT NULL,
  `started_at` TEXT,
  `completed_at` TEXT,
  `http_status` INTEGER,
  `provider_reference` TEXT,
  `normalized_result` TEXT,
  `sanitized_response` TEXT,
  `error_code` TEXT,
  `error_message` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  CONSTRAINT `auto_light_quote_offers_request_operation_attempt_unique`
    UNIQUE (`quote_request_id`, `operation_id`, `attempt_number`),
  FOREIGN KEY (`quote_request_id`) REFERENCES `auto_light_quote_requests`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK (`attempt_number` > 0),
  CHECK (`status` IN ('pending', 'in_progress', 'successful', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `auto_light_quote_offers_request_created_at_index`
  ON `auto_light_quote_offers` (`quote_request_id`, `created_at`);
