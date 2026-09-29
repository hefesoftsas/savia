-- Optional Request-store bootstrap rows. migratePostgres sets savia.seed for this transaction.
DO $seed$
BEGIN
  IF current_setting('savia.seed', true) IS DISTINCT FROM 'false' THEN
    INSERT INTO tenant_namespace_migrations(old_key, tenant_id) VALUES ('domain:platform', 0);
  END IF;
END
$seed$;
