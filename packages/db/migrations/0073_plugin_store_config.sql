ALTER TABLE plugin_store_artifacts ADD COLUMN store_json TEXT CHECK(store_json IS NULL OR json_valid(store_json));
