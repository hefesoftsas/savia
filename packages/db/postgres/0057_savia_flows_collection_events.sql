CREATE TABLE savia_core.savia_flows_collection_event_outbox (
  id text PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  collection_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('created','updated','deleted','restored')),
  record_id text NOT NULL,
  record_version integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  before_snapshot jsonb CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot) IS NOT NULL),
  after_snapshot jsonb CHECK (after_snapshot IS NULL OR jsonb_typeof(after_snapshot) IS NOT NULL),
  changed_fields jsonb NOT NULL CHECK (jsonb_typeof(changed_fields) = 'array'),
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  cause_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  available_at bigint NOT NULL DEFAULT 0,
  lease_token text,
  lease_expires_at bigint,
  delivered_at bigint,
  last_error text,
  created_at bigint NOT NULL,
  UNIQUE (tenant_id, collection_name, record_id, record_version, operation)
);
CREATE INDEX savia_flows_collection_events_ready
  ON savia_core.savia_flows_collection_event_outbox(status, available_at, lease_expires_at, created_at);
CREATE INDEX savia_flows_collection_events_delivered
  ON savia_core.savia_flows_collection_event_outbox(status, delivered_at);

CREATE TABLE savia_core.savia_flows_collection_receipts (
  tenant text NOT NULL,
  workflow_id text NOT NULL,
  execution_id text NOT NULL,
  node_id text NOT NULL,
  principal_id text NOT NULL,
  fingerprint text NOT NULL,
  response text NOT NULL CHECK (response::jsonb IS NOT NULL),
  created_at bigint NOT NULL,
  PRIMARY KEY (tenant, workflow_id, execution_id, node_id)
);

CREATE FUNCTION savia_core.savia_flows_capture_collection_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_actor_kind text;
  v_actor_id text;
  v_cause_id text;
  v_operation text;
  v_before jsonb;
  v_after jsonb;
  v_changed_fields jsonb := '[]'::jsonb;
  v_record_version integer;
  v_tenant text;
  v_object text;
  v_record text;
  v_created_at bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  v_tenant := NEW.tenant_id::text;
  v_object := NEW.object_name;
  v_record := NEW.id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    v_operation := 'created';
    v_before := NULL;
    v_after := NEW.data::jsonb || jsonb_build_object(
      'id',NEW.id,'_version',NEW.version,'created_at',NEW.created_at,
      'updated_at',NEW.updated_at,'deleted_at',NEW.deleted_at,'created_by',NEW.created_by
    );
    SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]'::jsonb) INTO v_changed_fields
    FROM jsonb_object_keys(NEW.data::jsonb) AS keys(key);
    v_record_version := NEW.version;
  ELSE
    IF OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
       AND (OLD.deleted_at IS NOT NULL OR OLD.data::jsonb IS NOT DISTINCT FROM NEW.data::jsonb) THEN
      RETURN NEW;
    END IF;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_operation := 'deleted';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_operation := 'restored';
    ELSE
      v_operation := 'updated';
    END IF;
    v_before := OLD.data::jsonb || jsonb_build_object(
      'id',OLD.id,'_version',OLD.version,'created_at',OLD.created_at,
      'updated_at',OLD.updated_at,'deleted_at',OLD.deleted_at,'created_by',OLD.created_by
    );
    v_after := NEW.data::jsonb || jsonb_build_object(
      'id',NEW.id,'_version',NEW.version,'created_at',NEW.created_at,
      'updated_at',NEW.updated_at,'deleted_at',NEW.deleted_at,'created_by',NEW.created_by
    );
    SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]'::jsonb) INTO v_changed_fields
    FROM (
      SELECT key FROM jsonb_object_keys(OLD.data::jsonb) AS keys(key)
      UNION
      SELECT key FROM jsonb_object_keys(NEW.data::jsonb) AS keys(key)
    ) fields
    WHERE OLD.data::jsonb->key IS DISTINCT FROM NEW.data::jsonb->key;
    v_record_version := NEW.version;
  END IF;

  SELECT actor_kind, actor_id, cause_id INTO v_actor_kind, v_actor_id, v_cause_id
  FROM savia_core.studio_record_history_context WHERE tenant_id=NEW.tenant_id LIMIT 1;
  IF v_actor_id IS NULL OR length(btrim(v_actor_id))=0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM savia_core.studio_schema_data archived
    JOIN savia_core.studio_objects current_schema
      ON current_schema.tenant_id=archived.tenant_id
     AND current_schema.name=archived.object_name
    WHERE archived.tenant_id=NEW.tenant_id
      AND archived.object_name=NEW.object_name
      AND archived.record_id=NEW.id
      AND archived.version=current_schema.version
  ) THEN RETURN NEW; END IF;

  INSERT INTO savia_core.savia_flows_collection_event_outbox(
    id,tenant_id,collection_name,operation,record_id,record_version,occurred_at,
    before_snapshot,after_snapshot,changed_fields,actor_kind,actor_id,cause_id,created_at
  ) VALUES (
    'sfe_'||md5(random()::text||clock_timestamp()::text),v_tenant,v_object,v_operation,
    v_record,v_record_version,clock_timestamp(),v_before,v_after,v_changed_fields,
    COALESCE(v_actor_kind,'user'),v_actor_id,v_cause_id,v_created_at
  ) ON CONFLICT (tenant_id,collection_name,record_id,record_version,operation) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER savia_flows_collection_events_insert
AFTER INSERT ON savia_core.studio_records
FOR EACH ROW EXECUTE FUNCTION savia_core.savia_flows_capture_collection_event();
CREATE TRIGGER savia_flows_collection_events_update
AFTER UPDATE ON savia_core.studio_records
FOR EACH ROW EXECUTE FUNCTION savia_core.savia_flows_capture_collection_event();
