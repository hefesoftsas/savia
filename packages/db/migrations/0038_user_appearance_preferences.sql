CREATE TABLE `user_appearance_preferences` (
  `principal_id` TEXT PRIMARY KEY NOT NULL,
  `settings` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  FOREIGN KEY (`principal_id`) REFERENCES `identity_principal`(`id`)
    ON UPDATE no action ON DELETE restrict
);
