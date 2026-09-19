CREATE TABLE `legacy_import_snapshots` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `manifest_sha256` TEXT NOT NULL UNIQUE,
  `stream_count` INTEGER NOT NULL CHECK (`stream_count` >= 0)
);
--> statement-breakpoint
CREATE TABLE `legacy_import_streams` (
  `snapshot_id` TEXT NOT NULL REFERENCES `legacy_import_snapshots`(`id`) ON DELETE RESTRICT,
  `source_type` TEXT NOT NULL,
  `source_name` TEXT NOT NULL,
  `destination_prefix` TEXT NOT NULL,
  `record_count` INTEGER NOT NULL CHECK (`record_count` >= 0),
  `byte_count` INTEGER NOT NULL CHECK (`byte_count` >= 0),
  `sha256` TEXT NOT NULL,
  PRIMARY KEY (`snapshot_id`, `source_type`, `source_name`)
);
