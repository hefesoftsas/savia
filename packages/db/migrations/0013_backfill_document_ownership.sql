INSERT OR IGNORE INTO `document_ownership` (
  `domain`,
  `collection`,
  `document_id`,
  `agency_id`,
  `created_at`,
  `updated_at`
)
SELECT
  'agency-network',
  'agency-profiles',
  CAST(`id` AS TEXT),
  `id`,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM `agencies`;
--> statement-breakpoint
INSERT OR IGNORE INTO `document_ownership` (
  `domain`,
  `collection`,
  `document_id`,
  `agency_id`,
  `created_at`,
  `updated_at`
)
SELECT
  'customer-portfolio',
  'customer-profiles',
  CAST(`id` AS TEXT),
  `agency_id`,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM `customer_clientagency`;
