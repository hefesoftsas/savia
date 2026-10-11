ALTER TABLE savia_core.plugin_authoring_projects
  ADD COLUMN editor_extensions TEXT NOT NULL DEFAULT '[]'
  CHECK (savia_core.savia_json_valid(editor_extensions));
