CREATE TABLE `assistant_pending_actions` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `principal_id` TEXT NOT NULL,
  `domain` TEXT NOT NULL,
  `command` TEXT NOT NULL,
  `input_json` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `expires_at` TEXT NOT NULL,
  `resolved_at` TEXT,
  `result_json` TEXT,
  CHECK (`status` IN ('pending', 'executing', 'completed', 'failed', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE INDEX `assistant_pending_actions_principal_status_index`
ON `assistant_pending_actions` (`principal_id`, `status`, `expires_at`);
