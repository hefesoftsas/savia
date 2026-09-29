-- Keep an external-content trigram index for general record searches. The
-- source row is tenant/object scoped and retains every record, including trash.
CREATE TABLE studio_record_search (
  rowid INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  search_text TEXT NOT NULL,
  UNIQUE (tenant_id, object_name, record_id)
);
CREATE VIRTUAL TABLE studio_record_search_fts USING fts5(
  search_text,
  tenant_id UNINDEXED,
  object_name UNINDEXED,
  record_id UNINDEXED,
  content='studio_record_search',
  content_rowid='rowid',
  tokenize='trigram'
);
CREATE TRIGGER studio_record_search_fts_insert AFTER INSERT ON studio_record_search BEGIN
  INSERT INTO studio_record_search_fts(rowid, search_text, tenant_id, object_name, record_id)
  VALUES (NEW.rowid, NEW.search_text, NEW.tenant_id, NEW.object_name, NEW.record_id);
END;
CREATE TRIGGER studio_record_search_fts_before_delete BEFORE DELETE ON studio_record_search BEGIN
  INSERT INTO studio_record_search_fts(studio_record_search_fts, rowid, search_text, tenant_id, object_name, record_id)
  VALUES ('delete', OLD.rowid, OLD.search_text, OLD.tenant_id, OLD.object_name, OLD.record_id);
END;
CREATE TRIGGER studio_record_search_fts_before_update BEFORE UPDATE ON studio_record_search BEGIN
  INSERT INTO studio_record_search_fts(studio_record_search_fts, rowid, search_text, tenant_id, object_name, record_id)
  VALUES ('delete', OLD.rowid, OLD.search_text, OLD.tenant_id, OLD.object_name, OLD.record_id);
END;
CREATE TRIGGER studio_record_search_fts_update AFTER UPDATE ON studio_record_search BEGIN
  INSERT INTO studio_record_search_fts(rowid, search_text, tenant_id, object_name, record_id)
  VALUES (NEW.rowid, NEW.search_text, NEW.tenant_id, NEW.object_name, NEW.record_id);
END;
INSERT INTO studio_record_search(rowid, tenant_id, object_name, record_id, search_text)
SELECT r.rowid, r.tenant_id, r.object_name, r.id,
       COALESCE((SELECT group_concat(CAST(search.value AS TEXT), '')
                 FROM json_each(r.data, '$') AS search), '')
FROM studio_records AS r;
CREATE TRIGGER studio_record_search_insert AFTER INSERT ON studio_records BEGIN
  INSERT INTO studio_record_search(rowid, tenant_id, object_name, record_id, search_text)
  SELECT NEW.rowid, NEW.tenant_id, NEW.object_name, NEW.id,
         COALESCE((SELECT group_concat(CAST(search.value AS TEXT), '')
                   FROM json_each(NEW.data, '$') AS search), '')
  ON CONFLICT(tenant_id, object_name, record_id) DO UPDATE SET
    rowid=excluded.rowid, search_text=excluded.search_text;
END;
CREATE TRIGGER studio_record_search_update
AFTER UPDATE OF tenant_id, object_name, id, data ON studio_records BEGIN
  UPDATE studio_record_search SET
    rowid=NEW.rowid,
    tenant_id=NEW.tenant_id,
    object_name=NEW.object_name,
    record_id=NEW.id,
    search_text=COALESCE((SELECT group_concat(CAST(search.value AS TEXT), '')
                          FROM json_each(NEW.data, '$') AS search), '')
  WHERE rowid=OLD.rowid;
END;
CREATE TRIGGER studio_record_search_delete AFTER DELETE ON studio_records BEGIN
  DELETE FROM studio_record_search
  WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name AND record_id=OLD.id;
END;
