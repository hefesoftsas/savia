-- Optional core bootstrap rows. migratePostgres sets savia.seed for this transaction.
DO $seed$
BEGIN
  IF current_setting('savia.seed', true) IS DISTINCT FROM 'false' THEN
    INSERT INTO server_id_sequences(resource, next_id) VALUES ('agencies', 1);
    INSERT INTO server_id_sequences(resource, next_id) VALUES ('tenants', 1);
    INSERT INTO tenants(id, id_slug, name, is_active, created_at, updated_at, kind)
      VALUES (0, 'savia-platform', 'Plataforma Savia', 1,
        to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'platform');
    INSERT INTO assistant_virtual_employees(id, agency_id, name, handle, position, avatar, greeting, system_prompt, allowed_collections, model, status, created_at, updated_at, created_by)
      VALUES ('emp-default-ventas', NULL, 'Laura - Ventas', 'ventas', 'Especialista en Ventas y Cotizaciones', 'briefcase', '¡Hola! Soy Laura, tu especialista en ventas y cotizaciones. ¿En qué oportunidad o cliente puedo ayudarte hoy?', 'Eres Laura, especialista en ventas y cotizaciones del equipo Savia. Tu objetivo es asesorar con agilidad en oportunidades de venta, cotizaciones de seguros y seguimiento a clientes prospectos. Eres proactiva, cordial y orientada al cierre de negocios.', '["*"]', NULL, 'active', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z', 'system');
    INSERT INTO assistant_virtual_employees(id, agency_id, name, handle, position, avatar, greeting, system_prompt, allowed_collections, model, status, created_at, updated_at, created_by)
      VALUES ('emp-default-soporte', NULL, 'Carlos - Soporte', 'soporte', 'Especialista en Atención y Pólizas', 'headset', 'Hola, soy Carlos de soporte. Estoy aquí para asistirte con consultas operativas, estado de pólizas y atención a usuarios.', 'Eres Carlos, especialista en soporte y atención al cliente en Savia. Tu misión es resolver dudas operativas, verificar coberturas, pólizas y estatus de reclamos con tono empático, claro y pedagógico.', '["*"]', NULL, 'active', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z', 'system');
    INSERT INTO access_revisions(scope, revision) VALUES ('platform', 0);
    INSERT INTO access_revisions(scope, revision) VALUES ('tenant:0', 1);
    INSERT INTO tenant_namespace_migrations(old_key, tenant_id) VALUES ('domain:platform', 0);
    INSERT INTO tenant_namespace_migrations(old_key, tenant_id) VALUES ('agency:0', 0);
  END IF;
END
$seed$;
