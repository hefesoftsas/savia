ALTER TABLE `admin_oauth_transactions`
ADD COLUMN `initiated_origin` TEXT;
--> statement-breakpoint
CREATE TABLE `admin_oauth_session_origins` (
  `token_hash` TEXT PRIMARY KEY NOT NULL,
  `origin` TEXT NOT NULL,
  `expires_at` TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_oauth_session_origins_expires_at_index`
ON `admin_oauth_session_origins` (`expires_at`);
