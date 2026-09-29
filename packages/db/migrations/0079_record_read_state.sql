-- Exact per-tenant/object record counts and revisions for safe read acceleration.
CREATE TABLE studio_record_counts (
  tenant_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  active_count INTEGER NOT NULL DEFAULT 0 CHECK(active_count >= 0),
  trash_count INTEGER NOT NULL DEFAULT 0 CHECK(trash_count >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  PRIMARY KEY (tenant_id, object_name)
);
--> statement-breakpoint
INSERT INTO studio_record_counts (tenant_id, object_name, active_count, trash_count, revision)
SELECT tenant_id, object_name,
       SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END),
       SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END),
       1
FROM studio_records
GROUP BY tenant_id, object_name;
--> statement-breakpoint
CREATE TABLE studio_record_read_cache (
  tenant_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  revision INTEGER NOT NULL,
  query_fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, object_name, revision, query_fingerprint)
);
--> statement-breakpoint
CREATE INDEX studio_record_read_cache_expiry ON studio_record_read_cache(expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_records_active_updated_order
  ON studio_records(tenant_id, object_name, deleted_at, updated_at DESC, id ASC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_records_active_created_order
  ON studio_records(tenant_id, object_name, deleted_at, created_at DESC, id ASC);
--> statement-breakpoint
CREATE TRIGGER studio_record_counts_insert AFTER INSERT ON studio_records
BEGIN
  INSERT INTO studio_record_counts(tenant_id, object_name, active_count, trash_count, revision)
  VALUES(NEW.tenant_id, NEW.object_name,
         CASE WHEN NEW.deleted_at IS NULL THEN 1 ELSE 0 END,
         CASE WHEN NEW.deleted_at IS NULL THEN 0 ELSE 1 END,
         1)
  ON CONFLICT(tenant_id, object_name) DO UPDATE SET
    active_count = active_count + excluded.active_count,
    trash_count = trash_count + excluded.trash_count,
    revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_counts_update_old BEFORE UPDATE ON studio_records
BEGIN
  UPDATE studio_record_counts
  SET active_count = active_count - CASE WHEN OLD.deleted_at IS NULL THEN 1 ELSE 0 END,
      trash_count = trash_count - CASE WHEN OLD.deleted_at IS NULL THEN 0 ELSE 1 END,
      revision = revision + CASE
        WHEN OLD.tenant_id <> NEW.tenant_id OR OLD.object_name <> NEW.object_name THEN 1
        ELSE 0
      END
  WHERE tenant_id = OLD.tenant_id AND object_name = OLD.object_name;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_counts_update_new AFTER UPDATE ON studio_records
BEGIN
  INSERT INTO studio_record_counts(tenant_id, object_name, active_count, trash_count, revision)
  VALUES(NEW.tenant_id, NEW.object_name,
         CASE WHEN NEW.deleted_at IS NULL THEN 1 ELSE 0 END,
         CASE WHEN NEW.deleted_at IS NULL THEN 0 ELSE 1 END,
         1)
  ON CONFLICT(tenant_id, object_name) DO UPDATE SET
    active_count = active_count + excluded.active_count,
    trash_count = trash_count + excluded.trash_count,
    revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_counts_delete AFTER DELETE ON studio_records
BEGIN
  UPDATE studio_record_counts
  SET active_count = active_count - CASE WHEN OLD.deleted_at IS NULL THEN 1 ELSE 0 END,
      trash_count = trash_count - CASE WHEN OLD.deleted_at IS NULL THEN 0 ELSE 1 END,
      revision = revision + 1
  WHERE tenant_id = OLD.tenant_id AND object_name = OLD.object_name;
END;
