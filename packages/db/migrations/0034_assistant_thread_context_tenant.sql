ALTER TABLE assistant_threads
  ADD COLUMN context_tenant_id INTEGER CHECK (
    context_tenant_id IS NULL OR context_tenant_id >= 0
  );

DROP INDEX assistant_threads_owner_context;

CREATE UNIQUE INDEX assistant_threads_owner_context
  ON assistant_threads(
    user_id,
    context_kind,
    context_id,
    ifnull(context_tenant_id, -1)
  )
  WHERE context_kind IS NOT NULL;
