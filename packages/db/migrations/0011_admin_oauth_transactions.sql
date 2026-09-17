CREATE TABLE `admin_oauth_transactions` (
  `state` TEXT PRIMARY KEY NOT NULL,
  `client_id` TEXT NOT NULL,
  `redirect_uri` TEXT NOT NULL,
  `code_verifier` TEXT NOT NULL,
  `expires_at` TEXT NOT NULL,
  `created_at` TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_oauth_transactions_expires_at_index`
ON `admin_oauth_transactions` (`expires_at`);
