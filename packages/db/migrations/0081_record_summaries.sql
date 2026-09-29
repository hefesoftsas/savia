-- Maintained grouped summaries for explicitly configured record fields.
CREATE TABLE studio_record_summary_definitions (
  tenant_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  group_field TEXT NOT NULL,
  amount_field TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, object_name, group_field, amount_field),
  FOREIGN KEY (tenant_id, object_name) REFERENCES studio_objects(tenant_id, name)
    ON DELETE CASCADE
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE studio_record_summary_groups (
  tenant_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  group_field TEXT NOT NULL,
  amount_field TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('null','number','text')),
  value_key,
  record_count INTEGER NOT NULL CHECK(record_count >= 0),
  amount REAL NOT NULL,
  PRIMARY KEY (tenant_id, object_name, group_field, amount_field, value_type, value_key),
  FOREIGN KEY (tenant_id, object_name, group_field, amount_field)
    REFERENCES studio_record_summary_definitions(tenant_id, object_name, group_field, amount_field)
    ON DELETE CASCADE
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TRIGGER studio_record_summary_insert AFTER INSERT ON studio_records BEGIN
  INSERT INTO studio_record_summary_groups
    (tenant_id, object_name, group_field, amount_field, value_type, value_key, record_count, amount)
  SELECT d.tenant_id, d.object_name, d.group_field, d.amount_field,
         CASE WHEN json_extract(NEW.data, '$.' || d.group_field) IS NULL THEN 'null'
              WHEN typeof(json_extract(NEW.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
         CASE WHEN json_extract(NEW.data, '$.' || d.group_field) IS NULL THEN ''
              ELSE json_extract(NEW.data, '$.' || d.group_field) END,
         1,
         CASE WHEN d.amount_field='' THEN 0.0
              ELSE COALESCE(CAST(json_extract(NEW.data, '$.' || d.amount_field) AS REAL), 0.0) END
  FROM studio_record_summary_definitions AS d
  WHERE d.tenant_id=NEW.tenant_id AND d.object_name=NEW.object_name
    AND NEW.deleted_at IS NULL
  ON CONFLICT(tenant_id, object_name, group_field, amount_field, value_type, value_key)
  DO UPDATE SET record_count=record_count+1, amount=amount+excluded.amount;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_summary_update AFTER UPDATE ON studio_records BEGIN
  DELETE FROM studio_record_summary_groups
  WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name
    AND record_count=1 AND OLD.deleted_at IS NULL
    AND (group_field,amount_field,value_type,value_key) IN (
      SELECT d.group_field,d.amount_field,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN 'null'
                  WHEN typeof(json_extract(OLD.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN ''
                  ELSE json_extract(OLD.data, '$.' || d.group_field) END
      FROM studio_record_summary_definitions AS d
      WHERE d.tenant_id=OLD.tenant_id AND d.object_name=OLD.object_name
    );
  UPDATE studio_record_summary_groups
  SET record_count=record_count-1,
      amount=amount-CASE WHEN amount_field='' THEN 0.0
                         ELSE COALESCE(CAST(json_extract(OLD.data, '$.' || amount_field) AS REAL), 0.0) END
  WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name
    AND record_count>1 AND OLD.deleted_at IS NULL
    AND (group_field,amount_field,value_type,value_key) IN (
      SELECT d.group_field,d.amount_field,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN 'null'
                  WHEN typeof(json_extract(OLD.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN ''
                  ELSE json_extract(OLD.data, '$.' || d.group_field) END
      FROM studio_record_summary_definitions AS d
      WHERE d.tenant_id=OLD.tenant_id AND d.object_name=OLD.object_name
    );
  INSERT INTO studio_record_summary_groups
    (tenant_id, object_name, group_field, amount_field, value_type, value_key, record_count, amount)
  SELECT d.tenant_id, d.object_name, d.group_field, d.amount_field,
         CASE WHEN json_extract(NEW.data, '$.' || d.group_field) IS NULL THEN 'null'
              WHEN typeof(json_extract(NEW.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
         CASE WHEN json_extract(NEW.data, '$.' || d.group_field) IS NULL THEN ''
              ELSE json_extract(NEW.data, '$.' || d.group_field) END,
         1,
         CASE WHEN d.amount_field='' THEN 0.0
              ELSE COALESCE(CAST(json_extract(NEW.data, '$.' || d.amount_field) AS REAL), 0.0) END
  FROM studio_record_summary_definitions AS d
  WHERE d.tenant_id=NEW.tenant_id AND d.object_name=NEW.object_name
    AND NEW.deleted_at IS NULL
  ON CONFLICT(tenant_id, object_name, group_field, amount_field, value_type, value_key)
  DO UPDATE SET record_count=record_count+1, amount=amount+excluded.amount;
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_summary_delete AFTER DELETE ON studio_records BEGIN
  DELETE FROM studio_record_summary_groups
  WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name
    AND record_count=1 AND OLD.deleted_at IS NULL
    AND (group_field,amount_field,value_type,value_key) IN (
      SELECT d.group_field,d.amount_field,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN 'null'
                  WHEN typeof(json_extract(OLD.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN ''
                  ELSE json_extract(OLD.data, '$.' || d.group_field) END
      FROM studio_record_summary_definitions AS d
      WHERE d.tenant_id=OLD.tenant_id AND d.object_name=OLD.object_name
    );
  UPDATE studio_record_summary_groups
  SET record_count=record_count-1,
      amount=amount-CASE WHEN amount_field='' THEN 0.0
                         ELSE COALESCE(CAST(json_extract(OLD.data, '$.' || amount_field) AS REAL), 0.0) END
  WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name
    AND record_count>1 AND OLD.deleted_at IS NULL
    AND (group_field,amount_field,value_type,value_key) IN (
      SELECT d.group_field,d.amount_field,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN 'null'
                  WHEN typeof(json_extract(OLD.data, '$.' || d.group_field)) IN ('integer','real') THEN 'number' ELSE 'text' END,
             CASE WHEN json_extract(OLD.data, '$.' || d.group_field) IS NULL THEN ''
                  ELSE json_extract(OLD.data, '$.' || d.group_field) END
      FROM studio_record_summary_definitions AS d
      WHERE d.tenant_id=OLD.tenant_id AND d.object_name=OLD.object_name
    );
END;
