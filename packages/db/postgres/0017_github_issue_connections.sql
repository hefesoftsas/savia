ALTER TABLE savia_core.personal_integration_connections
  DROP CONSTRAINT personal_integration_connections_provider_check;
ALTER TABLE savia_core.personal_integration_connections
  ADD CONSTRAINT personal_integration_connections_provider_check
  CHECK (provider = ANY (ARRAY[
    'google_drive'::text,
    'gmail'::text,
    'google_calendar'::text,
    'outlook'::text,
    'onedrive_personal'::text,
    'onedrive_business'::text,
    'jira'::text,
    'linear'::text,
    'github'::text
  ]));
