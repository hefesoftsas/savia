ALTER TABLE savia_core.assistant_threads
  ADD COLUMN context_tenant_id BIGINT CHECK (
    context_tenant_id IS NULL OR context_tenant_id >= 0
  );

DROP INDEX savia_core.assistant_threads_owner_context;

CREATE UNIQUE INDEX assistant_threads_owner_context
  ON savia_core.assistant_threads(
    user_id,
    context_kind,
    context_id,
    COALESCE(context_tenant_id, -1)
  )
  WHERE context_kind IS NOT NULL;
