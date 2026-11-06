CREATE TABLE `office_settings` (
  `tenant_id` INTEGER PRIMARY KEY NOT NULL REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  `platform_allowed` INTEGER NOT NULL DEFAULT 1 CHECK (`platform_allowed` IN (0,1)),
  `tenant_enabled` INTEGER NOT NULL DEFAULT 1 CHECK (`tenant_enabled` IN (0,1)),
  `updated_by` TEXT REFERENCES `identity_principal`(`id`) ON DELETE SET NULL,
  `updated_at` TEXT NOT NULL
);
