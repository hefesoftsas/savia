ALTER TABLE plugin_authoring_projects
  ADD COLUMN editor_extensions TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(editor_extensions));
