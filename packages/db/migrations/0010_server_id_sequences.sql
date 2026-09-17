CREATE TABLE `server_id_sequences` (
  `resource` TEXT PRIMARY KEY NOT NULL,
  `next_id` BIGINT NOT NULL
);
--> statement-breakpoint
INSERT INTO `server_id_sequences` (`resource`, `next_id`)
SELECT 'agencies', COALESCE(MAX(`id`), 0) + 1
FROM `agencies`;
