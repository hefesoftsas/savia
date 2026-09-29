CREATE TABLE savia_core.studio_record_counts (
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    active_count bigint NOT NULL DEFAULT 0 CHECK (active_count >= 0),
    trash_count bigint NOT NULL DEFAULT 0 CHECK (trash_count >= 0),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    PRIMARY KEY (tenant_id, object_name)
);

CREATE TABLE savia_core.studio_record_summary_definitions (
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    group_field text NOT NULL,
    amount_field text NOT NULL DEFAULT '',
    PRIMARY KEY (tenant_id, object_name, group_field, amount_field)
);

CREATE TABLE savia_core.studio_record_summary_groups (
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    group_field text NOT NULL,
    amount_field text NOT NULL DEFAULT '',
    value_type text NOT NULL CHECK (value_type IN ('null', 'number', 'text')),
    value_key text NOT NULL,
    record_count bigint NOT NULL CHECK (record_count >= 0),
    amount double precision NOT NULL DEFAULT 0.0,
    PRIMARY KEY (tenant_id, object_name, group_field, amount_field, value_type, value_key),
    FOREIGN KEY (tenant_id, object_name, group_field, amount_field)
      REFERENCES savia_core.studio_record_summary_definitions(tenant_id, object_name, group_field, amount_field)
      ON DELETE CASCADE
);

CREATE INDEX studio_record_summary_groups_rank
    ON savia_core.studio_record_summary_groups(tenant_id, object_name, group_field, amount_field, record_count DESC);

CREATE FUNCTION savia_core.studio_record_summary_value(p_data text, p_field text)
RETURNS TABLE(value_type text, value_key text)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = savia_core, pg_catalog
AS $$
DECLARE
  v_node jsonb;
  v_type text;
BEGIN
  v_node := p_data::jsonb -> p_field;
  v_type := jsonb_typeof(v_node);
  IF v_type IS NULL OR v_type = 'null' THEN
    value_type := 'null';
    value_key := '';
  ELSIF v_type = 'boolean' OR v_type = 'number' THEN
    value_type := 'number';
    value_key := trim_scale(CASE WHEN v_type = 'boolean' THEN
      CASE WHEN v_node = 'true'::jsonb THEN 1::numeric ELSE 0::numeric END
    ELSE (v_node #>> '{}')::numeric END)::text;
  ELSIF v_type = 'string' OR v_type IN ('array', 'object') THEN
    value_type := 'text';
    value_key := CASE WHEN v_type = 'string' THEN v_node #>> '{}'
      ELSE regexp_replace((p_data::json -> p_field)::text,
        '("(?:[^"\\]|\\.)*")|\s+', '\1', 'g') END;
  ELSE
    RAISE EXCEPTION 'unsupported JSON summary type: %', v_type;
  END IF;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION savia_core.studio_record_summary_amount(p_data text, p_field text)
RETURNS double precision
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = savia_core, pg_catalog
AS $$
DECLARE
  v_node jsonb;
  v_type text;
  v_text text;
  v_prefix text;
BEGIN
  v_node := p_data::jsonb -> p_field;
  v_type := jsonb_typeof(v_node);
  IF v_type IS NULL OR v_type = 'null' THEN
    RETURN 0.0;
  ELSIF v_type = 'boolean' THEN
    RETURN CASE WHEN v_node = 'true'::jsonb THEN 1.0 ELSE 0.0 END;
  ELSIF v_type = 'number' THEN
    RETURN (v_node #>> '{}')::double precision;
  ELSIF v_type = 'string' THEN
    v_text := v_node #>> '{}';
    v_prefix := substring(v_text FROM '^[[:space:]]*[+-]?(([0-9]+([.][0-9]*)?)|([.][0-9]+))([eE][+-]?[0-9]+)?');
    RETURN COALESCE(NULLIF(btrim(v_prefix), '')::double precision, 0.0);
  END IF;
  RETURN 0.0;
END;
$$;

CREATE FUNCTION savia_core.studio_record_count_delta(
  p_tenant text, p_object text, p_active bigint, p_trash bigint, p_revision bigint
) RETURNS void
LANGUAGE plpgsql
SET search_path = savia_core, pg_catalog
AS $$
BEGIN
  IF p_active < 0 OR p_trash < 0 OR (p_active = 0 AND p_trash = 0) THEN
    UPDATE studio_record_counts
    SET active_count = active_count + p_active,
        trash_count = trash_count + p_trash,
        revision = revision + p_revision
    WHERE tenant_id = p_tenant AND object_name = p_object;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'record count state missing for %.%', p_tenant, p_object;
    END IF;
  ELSE
    INSERT INTO studio_record_counts(tenant_id, object_name, active_count, trash_count, revision)
    VALUES (p_tenant, p_object, p_active, p_trash, p_revision)
    ON CONFLICT (tenant_id, object_name) DO UPDATE SET
      active_count = studio_record_counts.active_count + EXCLUDED.active_count,
      trash_count = studio_record_counts.trash_count + EXCLUDED.trash_count,
      revision = studio_record_counts.revision + EXCLUDED.revision;
  END IF;
  RETURN;
END;
$$;

CREATE FUNCTION savia_core.studio_record_summary_group_delta(
  p_tenant text, p_object text, p_group text, p_amount_field text,
  p_value_type text, p_value_key text, p_count_delta bigint, p_amount_delta double precision
) RETURNS void
LANGUAGE plpgsql
SET search_path = savia_core, pg_catalog
AS $$
BEGIN
  IF p_count_delta > 0 THEN
    INSERT INTO studio_record_summary_groups
      (tenant_id, object_name, group_field, amount_field, value_type, value_key, record_count, amount)
    VALUES (p_tenant, p_object, p_group, p_amount_field, p_value_type, p_value_key, p_count_delta, p_amount_delta)
    ON CONFLICT (tenant_id, object_name, group_field, amount_field, value_type, value_key)
    DO UPDATE SET record_count = studio_record_summary_groups.record_count + EXCLUDED.record_count,
                  amount = studio_record_summary_groups.amount + EXCLUDED.amount;
  ELSIF p_count_delta < 0 THEN
    UPDATE studio_record_summary_groups
    SET record_count = record_count + p_count_delta,
        amount = amount + p_amount_delta
    WHERE tenant_id = p_tenant AND object_name = p_object
      AND group_field = p_group AND amount_field = p_amount_field
      AND value_type = p_value_type AND value_key = p_value_key
      AND record_count >= -p_count_delta;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'record summary state missing or underflow for %.%.%.%',
        p_tenant, p_object, p_group, p_value_key;
    END IF;
    DELETE FROM studio_record_summary_groups
    WHERE tenant_id = p_tenant AND object_name = p_object
      AND group_field = p_group AND amount_field = p_amount_field
      AND value_type = p_value_type AND value_key = p_value_key
      AND record_count = 0;
  ELSIF p_amount_delta <> 0 THEN
    UPDATE studio_record_summary_groups SET amount = amount + p_amount_delta
    WHERE tenant_id = p_tenant AND object_name = p_object
      AND group_field = p_group AND amount_field = p_amount_field
      AND value_type = p_value_type AND value_key = p_value_key;
  END IF;
END;
$$;

CREATE FUNCTION savia_core.studio_record_summary_delta(
  p_tenant text, p_object text, p_data text, p_delta bigint
) RETURNS void
LANGUAGE plpgsql
SET search_path = savia_core, pg_catalog
AS $$
DECLARE
  d record;
  v_type text;
  v_key text;
  v_amount double precision;
BEGIN
  FOR d IN
    SELECT group_field, amount_field
    FROM studio_record_summary_definitions
    WHERE tenant_id = p_tenant AND object_name = p_object
    ORDER BY group_field, amount_field
  LOOP
    SELECT value_type, value_key INTO v_type, v_key
    FROM studio_record_summary_value(p_data, d.group_field);
    v_amount := CASE WHEN d.amount_field = '' THEN 0.0
      ELSE studio_record_summary_amount(p_data, d.amount_field) END;
    PERFORM studio_record_summary_group_delta(
      p_tenant, p_object, d.group_field, d.amount_field,
      v_type, v_key, p_delta, p_delta * v_amount
    );
  END LOOP;
END;
$$;

CREATE FUNCTION savia_core.studio_record_read_state_insert_fn()
RETURNS trigger LANGUAGE plpgsql
SET search_path = savia_core, pg_catalog
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tenant_id, object_name,
      count(*) FILTER (WHERE deleted_at IS NULL) AS active_delta,
      count(*) FILTER (WHERE deleted_at IS NOT NULL) AS trash_delta,
      count(*) AS revision_delta
    FROM new_rows
    GROUP BY tenant_id, object_name
    ORDER BY tenant_id, object_name
  LOOP
    PERFORM studio_record_count_delta(
      r.tenant_id, r.object_name, r.active_delta, r.trash_delta, r.revision_delta
    );
  END LOOP;

  FOR r IN
    SELECT n.tenant_id, n.object_name, d.group_field, d.amount_field,
      v.value_type, v.value_key, count(*) AS record_delta,
      sum(CASE WHEN d.amount_field = '' THEN 0.0
        ELSE studio_record_summary_amount(n.data, d.amount_field) END) AS amount_delta
    FROM new_rows n
    JOIN studio_record_summary_definitions d
      ON d.tenant_id = n.tenant_id AND d.object_name = n.object_name
    CROSS JOIN LATERAL studio_record_summary_value(n.data, d.group_field) v
    WHERE n.deleted_at IS NULL
    GROUP BY n.tenant_id, n.object_name, d.group_field, d.amount_field,
      v.value_type, v.value_key
    ORDER BY n.tenant_id, n.object_name, d.group_field, d.amount_field,
      v.value_type, v.value_key
  LOOP
    PERFORM studio_record_summary_group_delta(
      r.tenant_id, r.object_name, r.group_field, r.amount_field,
      r.value_type, r.value_key, r.record_delta, r.amount_delta
    );
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION savia_core.studio_record_read_state_update_fn()
RETURNS trigger LANGUAGE plpgsql
SET search_path = savia_core, pg_catalog
AS $$
DECLARE
  r record;
  old_active bigint := CASE WHEN OLD.deleted_at IS NULL THEN 1 ELSE 0 END;
  old_trash bigint := CASE WHEN OLD.deleted_at IS NULL THEN 0 ELSE 1 END;
  new_active bigint := CASE WHEN NEW.deleted_at IS NULL THEN 1 ELSE 0 END;
  new_trash bigint := CASE WHEN NEW.deleted_at IS NULL THEN 0 ELSE 1 END;
BEGIN
  IF OLD.tenant_id = NEW.tenant_id AND OLD.object_name = NEW.object_name THEN
    PERFORM studio_record_count_delta(NEW.tenant_id, NEW.object_name,
      new_active - old_active, new_trash - old_trash, 1);
    IF OLD.deleted_at IS NULL THEN
      PERFORM studio_record_summary_delta(OLD.tenant_id, OLD.object_name, OLD.data, -1);
    END IF;
    IF NEW.deleted_at IS NULL THEN
      PERFORM studio_record_summary_delta(NEW.tenant_id, NEW.object_name, NEW.data, 1);
    END IF;
  ELSE
    -- All row-state paths acquire count locks in tenant/object order on moves.
    FOR r IN
      SELECT tenant_id, object_name FROM (VALUES
        (OLD.tenant_id, OLD.object_name), (NEW.tenant_id, NEW.object_name)
      ) AS keys(tenant_id, object_name)
      GROUP BY tenant_id, object_name ORDER BY tenant_id, object_name
    LOOP
      IF r.tenant_id = OLD.tenant_id AND r.object_name = OLD.object_name THEN
        PERFORM studio_record_count_delta(r.tenant_id, r.object_name, -old_active, -old_trash, 1);
        IF OLD.deleted_at IS NULL THEN
          PERFORM studio_record_summary_delta(OLD.tenant_id, OLD.object_name, OLD.data, -1);
        END IF;
      ELSE
        PERFORM studio_record_count_delta(r.tenant_id, r.object_name, new_active, new_trash, 1);
        IF NEW.deleted_at IS NULL THEN
          PERFORM studio_record_summary_delta(NEW.tenant_id, NEW.object_name, NEW.data, 1);
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION savia_core.studio_record_read_state_delete_fn()
RETURNS trigger LANGUAGE plpgsql
SET search_path = savia_core, pg_catalog
AS $$
BEGIN
  PERFORM studio_record_count_delta(OLD.tenant_id, OLD.object_name,
    CASE WHEN OLD.deleted_at IS NULL THEN -1 ELSE 0 END,
    CASE WHEN OLD.deleted_at IS NULL THEN 0 ELSE -1 END, 1);
  IF OLD.deleted_at IS NULL THEN
    PERFORM studio_record_summary_delta(OLD.tenant_id, OLD.object_name, OLD.data, -1);
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER studio_record_read_state_insert
AFTER INSERT ON savia_core.studio_records
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION savia_core.studio_record_read_state_insert_fn();
CREATE TRIGGER studio_record_read_state_update
AFTER UPDATE ON savia_core.studio_records
FOR EACH ROW EXECUTE FUNCTION savia_core.studio_record_read_state_update_fn();
CREATE TRIGGER studio_record_read_state_delete
AFTER DELETE ON savia_core.studio_records
FOR EACH ROW EXECUTE FUNCTION savia_core.studio_record_read_state_delete_fn();

CREATE FUNCTION savia_core.studio_rebuild_record_read_state()
RETURNS void
LANGUAGE plpgsql
SET search_path = savia_core, pg_catalog
AS $$
BEGIN
  LOCK TABLE studio_records IN SHARE ROW EXCLUSIVE MODE;
  TRUNCATE studio_record_summary_groups, studio_record_summary_definitions, studio_record_counts;

  INSERT INTO studio_record_counts(tenant_id, object_name, active_count, trash_count, revision)
  SELECT tenant_id, object_name,
         count(*) FILTER (WHERE deleted_at IS NULL),
         count(*) FILTER (WHERE deleted_at IS NOT NULL), 0
  FROM studio_records GROUP BY tenant_id, object_name;

  INSERT INTO studio_record_summary_definitions(tenant_id, object_name, group_field, amount_field)
  SELECT o.tenant_id, o.name, summary.value ->> 'group',
         COALESCE(summary.value ->> 'amountField', '')
  FROM studio_objects o
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(o.config::jsonb #> '{performance,summaries}', '[]'::jsonb)
  ) AS summary(value)
  WHERE summary.value ->> 'group' ~ '^[A-Za-z_][A-Za-z0-9_]*$'
    AND COALESCE(summary.value ->> 'amountField', '') ~ '^$|^[A-Za-z_][A-Za-z0-9_]*$'
  ON CONFLICT DO NOTHING;

  INSERT INTO studio_record_summary_groups
    (tenant_id, object_name, group_field, amount_field, value_type, value_key, record_count, amount)
  SELECT d.tenant_id, d.object_name, d.group_field, d.amount_field,
         v.value_type, v.value_key, count(*),
         sum(CASE WHEN d.amount_field = '' THEN 0.0
             ELSE studio_record_summary_amount(r.data, d.amount_field) END)
  FROM studio_record_summary_definitions d
  JOIN studio_records r ON r.tenant_id = d.tenant_id AND r.object_name = d.object_name
  CROSS JOIN LATERAL studio_record_summary_value(r.data, d.group_field) v
  WHERE r.deleted_at IS NULL
  GROUP BY d.tenant_id, d.object_name, d.group_field, d.amount_field, v.value_type, v.value_key;
END;
$$;

SELECT savia_core.studio_rebuild_record_read_state();
