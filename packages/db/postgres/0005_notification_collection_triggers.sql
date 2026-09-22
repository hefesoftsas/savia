CREATE OR REPLACE FUNCTION notification_record_event_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = savia_core, pg_catalog AS $$
DECLARE
  v_operation text;
  v_event_key text;
  v_event_id text;
  v_actor_kind text;
  v_actor_id text;
  v_payload text;
  v_created_at bigint;
  v_tenant text;
  v_object text;
  v_record text;
  v_title text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tenant := NEW.tenant_id; v_object := NEW.object_name; v_record := NEW.id;
    v_operation := 'created';
    v_event_key := 'record:' || v_tenant || ':' || v_object || ':' || v_record || ':' || NEW.version;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.data IS NOT DISTINCT FROM NEW.data
      AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
      RETURN NEW;
    END IF;
    v_tenant := NEW.tenant_id; v_object := NEW.object_name; v_record := NEW.id;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_operation := 'deleted';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_operation := 'created';
    ELSE
      v_operation := 'updated';
    END IF;
    v_event_key := 'record:' || v_tenant || ':' || v_object || ':' || v_record || ':' || NEW.version;
  ELSE
    v_tenant := OLD.tenant_id; v_object := OLD.object_name; v_record := OLD.id;
    v_operation := 'deleted';
    v_event_key := 'record:' || v_tenant || ':' || v_object || ':' || v_record || ':purged';
  END IF;
  v_title := v_object || ' ' || v_operation;
  IF v_operation = 'created' AND TG_OP = 'UPDATE' THEN
    v_title := v_object || ' restored';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM notification_subscriptions
    WHERE workspace_id = v_tenant AND collection = v_object
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  SELECT actor_kind, actor_id INTO v_actor_kind, v_actor_id
  FROM crm_record_history_context WHERE tenant_id = v_tenant LIMIT 1;
  v_actor_kind := COALESCE(v_actor_kind, 'system');
  v_event_id := 'ntf_' || md5(random()::text || clock_timestamp()::text || v_event_key);
  v_created_at := (extract(epoch FROM now()) * 1000)::bigint;
  v_payload := jsonb_build_object(
    'scope', jsonb_build_object('kind', 'workspace', 'id', v_tenant),
    'key', v_event_key,
    'actor', jsonb_build_object('kind', v_actor_kind, 'id', v_actor_id),
    'source', jsonb_build_object('kind', 'record', 'collection', v_object, 'id', v_record, 'operation', v_operation),
    'title', v_title,
    'body', '',
    'audience', jsonb_build_object('kind', 'collection-followers', 'collection', v_object),
    'createdAt', v_created_at,
    'expiresAt', NULL
  )::text;
  INSERT INTO notification_events(id, scope_kind, scope_id, event_key, payload, created_at)
  VALUES (v_event_id, 'workspace', v_tenant, v_event_key, v_payload, v_created_at);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notification_event_fanout_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = savia_core, pg_catalog AS $$
BEGIN
  INSERT INTO notification_deliveries(id, event_id, scope_kind, scope_id, recipient_id, created_at)
  SELECT 'dlv_' || NEW.id || '_' || s.principal_id, NEW.id, NEW.scope_kind, NEW.scope_id, s.principal_id, NEW.created_at
  FROM notification_subscriptions s
  WHERE s.workspace_id = NEW.scope_id
    AND s.collection = (NEW.payload::jsonb -> 'audience' ->> 'collection')
    AND (NEW.payload::jsonb -> 'audience' ->> 'kind') = 'collection-followers'
    AND ((NEW.payload::jsonb -> 'actor' ->> 'id') IS NULL OR s.principal_id <> (NEW.payload::jsonb -> 'actor' ->> 'id'))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$
--> statement-breakpoint
DROP TRIGGER IF EXISTS notification_record_insert ON crm_records;
--> statement-breakpoint
CREATE TRIGGER notification_record_insert AFTER INSERT ON crm_records
FOR EACH ROW EXECUTE FUNCTION notification_record_event_fn();
--> statement-breakpoint
DROP TRIGGER IF EXISTS notification_record_update ON crm_records;
--> statement-breakpoint
CREATE TRIGGER notification_record_update AFTER UPDATE ON crm_records
FOR EACH ROW EXECUTE FUNCTION notification_record_event_fn();
--> statement-breakpoint
DROP TRIGGER IF EXISTS notification_record_purge ON crm_records;
--> statement-breakpoint
CREATE TRIGGER notification_record_purge AFTER DELETE ON crm_records
FOR EACH ROW EXECUTE FUNCTION notification_record_event_fn();
--> statement-breakpoint
DROP TRIGGER IF EXISTS notification_event_fanout ON notification_events;
--> statement-breakpoint
CREATE TRIGGER notification_event_fanout AFTER INSERT ON notification_events
FOR EACH ROW EXECUTE FUNCTION notification_event_fanout_fn();
