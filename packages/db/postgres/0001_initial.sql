-- Native PostgreSQL initial schema snapshot generated from the final applied migration chain.
-- Seed rows are kept in 0002_bootstrap.sql and remain conditional on savia.seed.
SET LOCAL check_function_bodies TO false;

CREATE FUNCTION savia_core.access_global_role_added_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
UPDATE access_revisions SET revision=revision+1;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.access_global_role_removed_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
UPDATE access_revisions SET revision=revision+1;
RETURN OLD;
END $$;
CREATE FUNCTION savia_core.access_membership_changed_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
DELETE FROM access_assignments WHERE principal_id=OLD.principal_id AND scope='tenant:'||OLD.tenant_id
 AND (OLD.tenant_id<>NEW.tenant_id OR role_id LIKE 'builtin:%');
 INSERT INTO access_assignments(scope,principal_id,role_id)
 SELECT 'tenant:'||NEW.tenant_id,NEW.principal_id,'builtin:tenant:'||NEW.tenant_id||':'||NEW.role WHERE NEW.tenant_id>0 ON CONFLICT DO NOTHING;
 UPDATE access_revisions SET revision=revision+1 WHERE scope IN ('tenant:'||OLD.tenant_id,'tenant:'||NEW.tenant_id);
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.access_membership_created_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
IF NEW.tenant_id>0 THEN
INSERT INTO access_assignments(scope,principal_id,role_id)
 VALUES('tenant:'||NEW.tenant_id,NEW.principal_id,'builtin:tenant:'||NEW.tenant_id||':'||NEW.role) ON CONFLICT DO NOTHING;
 UPDATE access_revisions SET revision=revision+1 WHERE scope='tenant:'||NEW.tenant_id;
END IF;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.access_membership_removed_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
DELETE FROM access_assignments WHERE principal_id=OLD.principal_id AND scope='tenant:'||OLD.tenant_id;
 UPDATE access_revisions SET revision=revision+1 WHERE scope='tenant:'||OLD.tenant_id;
RETURN OLD;
END $$;
CREATE FUNCTION savia_core.access_object_changed_fn() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN UPDATE access_revisions SET revision=revision+1 WHERE scope=NEW.tenant_id; RETURN NEW; END $$;
CREATE FUNCTION savia_core.access_object_removed_fn() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN UPDATE access_revisions SET revision=revision+1 WHERE scope=OLD.tenant_id; RETURN OLD; END $$;
CREATE FUNCTION savia_core.access_principal_changed_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
UPDATE access_revisions SET revision=revision+1 WHERE scope IN (SELECT scope FROM access_assignments WHERE principal_id=NEW.id);
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.access_tenant_created_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
IF NEW.id>0 THEN
INSERT INTO access_revisions(scope) VALUES ('tenant:'||NEW.id) ON CONFLICT DO NOTHING;
 INSERT INTO access_roles(id,scope,name,label,protected,legacy_role)
 SELECT 'builtin:tenant:'||NEW.id||':'||r.name,'tenant:'||NEW.id,r.name,r.name,1,r.name
 FROM (SELECT 'tenant_admin' name UNION ALL SELECT 'agency_admin' UNION ALL SELECT 'operator' UNION ALL SELECT 'viewer') r;
END IF;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.access_tenant_removed_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
IF OLD.id>0 THEN
DELETE FROM access_roles WHERE scope='tenant:'||OLD.id;
 UPDATE access_revisions SET revision=revision+1 WHERE scope='tenant:'||OLD.id;
END IF;
RETURN OLD;
END $$;
CREATE FUNCTION savia_core.access_tenant_state_changed_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
UPDATE access_revisions SET revision=revision+1 WHERE scope='tenant:'||NEW.id;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.agency_crm_connection_audit_events_insert_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$ BEGIN
INSERT INTO "tenant_crm_connection_audit_events" (
    "id", "connection_id", "tenant_id", "principal_id", "provider",
    "event_type", "outcome", "error_code", "created_at"
  ) VALUES (
    NEW."id", NEW."connection_id", NEW."agency_id", NEW."principal_id", NEW."provider",
    NEW."event_type", NEW."outcome", NEW."error_code", NEW."created_at"
  );
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.agency_crm_connections_delete_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$ BEGIN
DELETE FROM "tenant_crm_connections" WHERE "id" = OLD."id";
RETURN OLD;
END $$;
CREATE FUNCTION savia_core.agency_crm_connections_insert_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$ BEGIN
INSERT INTO "tenant_crm_connections" (
    "id", "tenant_id", "created_by_principal_id", "provider",
    "nango_connection_id", "nango_integration_id", "status",
    "external_account_label", "scopes", "last_validated_at",
    "disconnected_at", "created_at", "updated_at", "external_account_id"
  ) VALUES (
    NEW."id", NEW."agency_id", NEW."created_by_principal_id", NEW."provider",
    NEW."nango_connection_id", NEW."nango_integration_id", NEW."status",
    NEW."external_account_label", COALESCE(NEW."scopes", '[]'), NEW."last_validated_at",
    NEW."disconnected_at", NEW."created_at", NEW."updated_at", NEW."external_account_id"
  );
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.agency_crm_connections_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$ BEGIN
UPDATE "tenant_crm_connections" SET
    "tenant_id" = NEW."agency_id",
    "nango_connection_id" = NEW."nango_connection_id",
    "nango_integration_id" = NEW."nango_integration_id",
    "status" = NEW."status",
    "external_account_label" = NEW."external_account_label",
    "external_account_id" = NEW."external_account_id",
    "scopes" = COALESCE(NEW."scopes", OLD."scopes", '[]'),
    "last_validated_at" = NEW."last_validated_at",
    "disconnected_at" = NEW."disconnected_at",
    "updated_at" = NEW."updated_at"
  WHERE "id" = OLD."id";
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.agency_tenant_create_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at)
 VALUES(NEW.id,NEW.id_slug,NEW.name,NEW.is_active,NEW.created_at,NEW.updated_at)
 ON CONFLICT(id) DO UPDATE SET id_slug=excluded.id_slug,name=excluded.name,is_active=excluded.is_active,updated_at=excluded.updated_at;
 UPDATE agencies SET tenant_id=NEW.id WHERE id=NEW.id;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.agency_tenant_identity_insert_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id != NEW.id THEN
RAISE EXCEPTION 'Agency profile must use its tenant identity';
END IF;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.agency_tenant_identity_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
IF NEW.id != OLD.id OR NEW.tenant_id IS NULL OR NEW.tenant_id != NEW.id THEN
RAISE EXCEPTION 'Agency profile must use its tenant identity';
END IF;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.agency_tenant_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
IF NEW.id_slug != OLD.id_slug OR NEW.name != OLD.name OR NEW.is_active != OLD.is_active OR NEW.updated_at != OLD.updated_at THEN
UPDATE tenants SET id_slug=NEW.id_slug,name=NEW.name,is_active=NEW.is_active,updated_at=NEW.updated_at WHERE id=NEW.id;
END IF;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.assistant_active_agencies_delete_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$ BEGIN
DELETE FROM "assistant_active_tenants" WHERE "principal_id" = OLD."principal_id";
RETURN OLD;
END $$;
CREATE FUNCTION savia_core.assistant_active_agencies_insert_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$ BEGIN
INSERT INTO "assistant_active_tenants" ("principal_id", "tenant_id", "updated_at")
  VALUES (NEW."principal_id", NEW."agency_id", NEW."updated_at")
  ON CONFLICT("principal_id") DO UPDATE SET
    "tenant_id" = excluded."tenant_id",
    "updated_at" = excluded."updated_at";
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_history_delete_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN DELETE FROM studio_record_history WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name AND record_id=OLD.id; RETURN OLD; END $$;
CREATE FUNCTION savia_core.crm_history_write_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
DECLARE changes jsonb := '{}'::jsonb; f record; before_value jsonb; after_value jsonb;
 retention integer; changed boolean := false; action text; at_time timestamptz := clock_timestamp();
BEGIN
 FOR f IN SELECT * FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name LOOP
  retention := f.retention_days;
  before_value := CASE WHEN TG_OP='UPDATE' THEN OLD.data::jsonb -> f.field_name ELSE NULL END;
  after_value := NEW.data::jsonb -> f.field_name;
  IF (TG_OP='INSERT' OR before_value IS DISTINCT FROM after_value)
    AND (jsonb_typeof(before_value) IN ('null','string','number','boolean') OR jsonb_typeof(after_value) IN ('null','string','number','boolean')) THEN
   changes := changes || jsonb_build_object(f.field_name, savia_history_value('before',before_value)||savia_history_value('after',after_value));
   changed := true;
  END IF;
 END LOOP;
 IF retention IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN action := 'created';
 ELSE
  IF NOT changed AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN RETURN NEW; END IF;
  action := CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restored' ELSE 'updated' END;
 END IF;
 INSERT INTO studio_record_history(tenant_id,object_name,record_id,version,action,created_at,actor_kind,actor_id,cause_id,changes,expires_at)
 VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.version,action,to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 COALESCE((SELECT actor_kind FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),'system'),
 (SELECT actor_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT cause_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),changes::text,
 to_char((at_time + retention * interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_record_links_cardinality_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
PERFORM 1 FROM studio_collection_relations
 WHERE tenant_id=NEW.tenant_id AND id=NEW.relation_id FOR UPDATE;
IF EXISTS (
 SELECT 1 FROM studio_collection_relations r JOIN studio_record_links e ON e.tenant_id=r.tenant_id AND e.relation_id=r.id
 WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.relation_id
 AND ((r.cardinality='one-to-one' AND e.source_id=NEW.source_id AND e.target_id<>NEW.target_id)
 OR (r.cardinality IN ('one-to-one','one-to-many') AND e.target_id=NEW.target_id AND e.source_id<>NEW.source_id))
 ) THEN RAISE EXCEPTION 'relation_cardinality_conflict'; END IF;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_record_links_storage_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
PERFORM 1 FROM studio_collection_relations
 WHERE tenant_id=NEW.tenant_id AND id=NEW.relation_id FOR UPDATE;
IF EXISTS(SELECT 1 FROM studio_collection_relations WHERE tenant_id=NEW.tenant_id AND id=NEW.relation_id AND storage<>'local') THEN RAISE EXCEPTION 'relation_mapping_has_links'; END IF;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_relation_definition_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
IF (NEW.source_field<>OLD.source_field OR NEW.target_field<>OLD.target_field OR NEW.storage<>OLD.storage) AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id) THEN RAISE EXCEPTION 'relation_mapping_has_links'; END IF;
 IF (NEW.cardinality='one-to-one' AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id GROUP BY source_id HAVING count(*)>1)) OR (NEW.cardinality IN ('one-to-one','one-to-many') AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id GROUP BY target_id HAVING count(*)>1)) THEN RAISE EXCEPTION 'relation_cardinality_conflict'; END IF;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_address_delete_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_naturalperson WHERE home_address_id=OLD.id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN OLD;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_address_insert_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_naturalperson WHERE home_address_id=NEW.id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_address_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_naturalperson WHERE home_address_id=NEW.id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_clientagency_insert_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_clientagency_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_deleted_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
UPDATE crm_sync_jobs SET revision=revision+1,status='blocked',last_error='SOURCE_DELETED',updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE customer_id=OLD.id;
RETURN OLD;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_legalperson_insert_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.client_id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_legalperson_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.client_id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_legalpersoncontact_delete_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_legalperson WHERE id=OLD.legal_person_id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN OLD;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_legalpersoncontact_insert_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_legalperson WHERE id=NEW.legal_person_id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_legalpersoncontact_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id IN (SELECT client_id FROM customer_legalperson WHERE id=NEW.legal_person_id)
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_naturalperson_insert_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.client_id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_customer_naturalperson_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_jobs(id,rule_id,customer_id)
 SELECT r.id || ':' || p.id,r.id,p.id FROM crm_sync_rules r JOIN customer_clientagency p ON p.agency_id=r.tenant_id
 WHERE r.enabled=1 AND p.id=NEW.client_id
 ON CONFLICT(rule_id,customer_id) DO UPDATE SET
 revision=crm_sync_jobs.revision+1,
 status=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.status ELSE 'pending' END,
 attempts=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.attempts ELSE 0 END,
 last_error=CASE WHEN crm_sync_jobs.status='processing' OR (crm_sync_jobs.status='blocked' AND COALESCE(crm_sync_jobs.last_error,'')<>'RULE_PAUSED') THEN crm_sync_jobs.last_error ELSE NULL END,
 next_attempt_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_delete_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (OLD.tenant_id,OLD.object_name,OLD.id,OLD.data,OLD.version+1,OLD.created_at,OLD.updated_at,COALESCE(OLD.deleted_at,to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),OLD.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
RETURN OLD;
END $$;
CREATE FUNCTION savia_core.crm_sync_insert_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.data,NEW.version,NEW.created_at,NEW.updated_at,NEW.deleted_at,NEW.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.crm_sync_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.data,NEW.version,NEW.created_at,NEW.updated_at,NEW.deleted_at,NEW.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.identity_principal_active_email_guard_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
DECLARE
  normalized_email TEXT := lower(btrim(NEW.email));
  should_check BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    should_check := NEW.is_active <> 0;
  ELSE
    should_check := NEW.is_active <> 0
      AND (OLD.is_active = 0 OR lower(btrim(NEW.email)) <> lower(btrim(OLD.email)));
  END IF;
  IF NOT should_check THEN
    RETURN NEW;
  END IF;
  -- Hash collisions only cause extra serialization; equal normalized emails
  -- always take the same transaction-scoped lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_email, 0));
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1
      FROM identity_principal AS existing
      WHERE existing.is_active <> 0
        AND lower(btrim(existing.email)) = normalized_email
        AND NOT (existing.issuer = NEW.issuer AND existing.subject = NEW.subject)
    ) AND NOT EXISTS (
      SELECT 1
      FROM identity_principal AS same_identity
      WHERE same_identity.issuer = NEW.issuer
        AND same_identity.subject = NEW.subject
    ) THEN
      RAISE EXCEPTION 'IDENTITY_EMAIL_CONFLICT'
        USING ERRCODE = '23505', CONSTRAINT = 'identity_principal_active_email_unique';
    END IF;
  ELSIF EXISTS (
    SELECT 1
    FROM identity_principal AS existing
    WHERE existing.id <> OLD.id
      AND existing.is_active <> 0
      AND lower(btrim(existing.email)) = normalized_email
  ) THEN
    RAISE EXCEPTION 'IDENTITY_EMAIL_CONFLICT'
      USING ERRCODE = '23505', CONSTRAINT = 'identity_principal_active_email_unique';
  END IF;
  RETURN NEW;
END
$$;
CREATE FUNCTION savia_core.notification_event_fanout_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
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
$$;
CREATE FUNCTION savia_core.notification_record_event_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
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
  FROM studio_record_history_context WHERE tenant_id = v_tenant LIMIT 1;
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
$$;
CREATE FUNCTION savia_core.savia_history_value(label text, value jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
 SELECT CASE WHEN jsonb_typeof(value) IN ('string','number','boolean') THEN
 jsonb_build_object(label,CASE WHEN jsonb_typeof(value)='string' THEN to_jsonb(left(value #>> '{}',2048)) ELSE value END)
 || CASE WHEN jsonb_typeof(value)='string' AND length(value #>> '{}')>2048 THEN jsonb_build_object(label||'Truncated',true) ELSE '{}'::jsonb END
 ELSE '{}'::jsonb END
$$;
CREATE FUNCTION savia_core.savia_json_valid(value text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN PERFORM value::json; RETURN value IS NOT NULL;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
CREATE FUNCTION savia_core.savia_workflow_comparison(value jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
 SELECT CASE WHEN value='true'::jsonb THEN '1'::jsonb WHEN value='false'::jsonb THEN '0'::jsonb ELSE NULLIF(value,'null'::jsonb) END
$$;
CREATE FUNCTION savia_core.savia_workflow_condition(actual jsonb, condition jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE expected jsonb := condition->'value'; kind text := jsonb_typeof(actual); operator text := condition->>'operator';
BEGIN
 RETURN COALESCE(CASE operator
 WHEN 'eq' THEN actual IS NOT NULL AND actual=expected
 WHEN 'neq' THEN actual IS NOT NULL AND actual<>expected
 WHEN 'gt' THEN CASE WHEN kind='number' THEN actual>expected ELSE false END
 WHEN 'gte' THEN CASE WHEN kind='number' THEN actual>=expected ELSE false END
 WHEN 'lt' THEN CASE WHEN kind='number' THEN actual<expected ELSE false END
 WHEN 'lte' THEN CASE WHEN kind='number' THEN actual<=expected ELSE false END
 WHEN 'contains' THEN kind='string' AND strpos(actual #>> '{}',expected #>> '{}')>0
 WHEN 'empty' THEN actual IS NULL OR kind='null' OR actual='""'::jsonb
 WHEN 'not_empty' THEN actual IS NOT NULL AND kind<>'null' AND actual<>'""'::jsonb
 ELSE false END,false);
END $$;
CREATE FUNCTION savia_core.savia_workflow_json_type(value json) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
 SELECT CASE json_typeof(value) WHEN 'boolean' THEN value::text
 WHEN 'number' THEN CASE WHEN value::text ~ '[.eE]' OR (value::text)::numeric NOT BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'real' ELSE 'integer' END
 WHEN 'string' THEN 'text' ELSE json_typeof(value) END
$$;
CREATE FUNCTION savia_core.tenant_agency_update_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
IF NEW.id_slug != OLD.id_slug OR NEW.name != OLD.name OR NEW.is_active != OLD.is_active OR NEW.updated_at != OLD.updated_at THEN
UPDATE agencies SET id_slug=NEW.id_slug,name=NEW.name,is_active=NEW.is_active,updated_at=NEW.updated_at WHERE tenant_id=NEW.id;
END IF;
RETURN NEW;
END $$;
CREATE FUNCTION savia_core.workflow_event_dispatch_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
 IF NEW.depth<5 THEN
 INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,node_id,context,depth)
 SELECT w.workspace_id,v.id||':'||NEW.id,w.id,v.id,v.owner_id,v.owner_id,'event:'||NEW.id,v.definition::jsonb #>> '{nodes,0,id}',
 jsonb_build_object('trigger',CASE WHEN NEW.kind='deleted' THEN NEW.before_state::jsonb ELSE NEW.after_state::jsonb END,'before',NEW.before_state::jsonb,'steps','{}'::jsonb,
 'system',jsonb_build_object('owner',v.owner_id,'workspace',w.workspace_id,'event',NEW.id,'eventType',NEW.kind,'cause',NEW.cause))::text,NEW.depth
 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.workspace_id AND w.enabled=1
 AND (v.definition::jsonb #>> '{trigger,type}'=NEW.kind OR (v.definition::jsonb #>> '{trigger,type}'='created_or_updated' AND NEW.kind IN ('created','updated')))
 AND v.definition::jsonb #>> '{trigger,collection}'=NEW.collection
 AND (NEW.kind<>'updated' OR COALESCE(jsonb_array_length(v.definition::jsonb #> '{trigger,changedFields}'),0)=0 OR EXISTS (
 SELECT 1 FROM jsonb_array_elements_text(v.definition::jsonb #> '{trigger,changedFields}') f(value)
 WHERE NEW.before_state::jsonb -> f.value IS DISTINCT FROM NEW.after_state::jsonb -> f.value
 OR savia_workflow_json_type(NEW.before_state::json -> f.value) IS DISTINCT FROM savia_workflow_json_type(NEW.after_state::json -> f.value)))
 AND (COALESCE(jsonb_array_length(v.definition::jsonb #> '{trigger,conditions}'),0)=0 OR (
 SELECT CASE WHEN v.definition::jsonb #>> '{trigger,conditionMode}'='any' THEN bool_or(savia_workflow_condition((CASE WHEN NEW.kind='deleted' THEN NEW.before_state::jsonb ELSE NEW.after_state::jsonb END) -> (f.value->>'field'),f.value)) ELSE bool_and(savia_workflow_condition((CASE WHEN NEW.kind='deleted' THEN NEW.before_state::jsonb ELSE NEW.after_state::jsonb END) -> (f.value->>'field'),f.value)) END
 FROM jsonb_array_elements(v.definition::jsonb #> '{trigger,conditions}') f(value)));
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION savia_core.workflow_record_delete_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
BEGIN
 IF OLD.deleted_at IS NOT NULL THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND NEW.deleted_at IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=OLD.tenant_id AND w.enabled=1 AND v.definition::jsonb #>> '{trigger,type}'='deleted' AND v.definition::jsonb #>> '{trigger,collection}'=OLD.object_name) THEN RETURN OLD; END IF;
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT OLD.tenant_id,OLD.object_name,'deleted',
 (OLD.data::jsonb || jsonb_build_object('id',OLD.id,'_version',OLD.version,'created_at',OLD.created_at,'updated_at',OLD.updated_at))::text,'{}',
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) dummy LEFT JOIN workflow_write_context c ON c.workspace_id=OLD.tenant_id AND c.record_id=OLD.id;
 RETURN OLD;
END $$;
CREATE FUNCTION savia_core.workflow_record_write_fn() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'savia_core', 'pg_catalog'
    AS $$
DECLARE event_kind text := CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END;
BEGIN
 IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (OLD.deleted_at IS NOT NULL OR NEW.data=OLD.data) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.tenant_id AND w.enabled=1 AND v.definition::jsonb #>> '{trigger,type}' IN (event_kind,'created_or_updated') AND v.definition::jsonb #>> '{trigger,collection}'=NEW.object_name) THEN RETURN NEW; END IF;
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT NEW.tenant_id,NEW.object_name,event_kind,
 CASE WHEN TG_OP='INSERT' THEN '{}' ELSE (OLD.data::jsonb || jsonb_build_object('id',OLD.id,'_version',OLD.version,'created_at',OLD.created_at,'updated_at',OLD.updated_at))::text END,
 (NEW.data::jsonb || jsonb_build_object('id',NEW.id,'_version',NEW.version,'created_at',NEW.created_at,'updated_at',NEW.updated_at))::text,
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) dummy LEFT JOIN workflow_write_context c ON c.workspace_id=NEW.tenant_id AND c.record_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TABLE savia_core.access_assignments (
    scope text NOT NULL,
    principal_id text NOT NULL,
    role_id text NOT NULL
);
CREATE TABLE savia_core.access_audit (
    id text NOT NULL,
    scope text NOT NULL,
    actor_id text NOT NULL,
    action text NOT NULL,
    target_id text NOT NULL,
    before_state text,
    after_state text,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL
);
CREATE TABLE savia_core.access_grants (
    id text NOT NULL,
    scope text NOT NULL,
    role_id text NOT NULL,
    resource text NOT NULL,
    action text NOT NULL,
    predicate text NOT NULL,
    fields text NOT NULL,
    CONSTRAINT access_grants_fields_check CHECK (savia_core.savia_json_valid(fields)),
    CONSTRAINT access_grants_predicate_check CHECK (savia_core.savia_json_valid(predicate))
);
CREATE TABLE savia_core.access_revisions (
    scope text NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    CONSTRAINT access_revisions_revision_check CHECK ((revision >= 0))
);
CREATE TABLE savia_core.access_roles (
    id text NOT NULL,
    scope text NOT NULL,
    name text NOT NULL,
    label text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    enabled bigint DEFAULT 1 NOT NULL,
    protected bigint DEFAULT 0 NOT NULL,
    legacy_role text,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT access_roles_enabled_check CHECK ((enabled = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT access_roles_protected_check CHECK ((protected = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);
CREATE TABLE savia_core.admin_oauth_transactions (
    state text NOT NULL,
    client_id text NOT NULL,
    redirect_uri text NOT NULL,
    code_verifier text NOT NULL,
    expires_at text NOT NULL,
    created_at text NOT NULL
);
CREATE TABLE savia_core.agencies (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    name text NOT NULL,
    address text NOT NULL,
    id_check_digit text NOT NULL,
    id_number text NOT NULL,
    phone text,
    logo text,
    city_id bigint,
    coordinates text,
    lr_id_number text NOT NULL,
    lr_id_type text NOT NULL,
    lr_name text NOT NULL,
    payments_email text NOT NULL,
    is_active bigint NOT NULL,
    email text NOT NULL,
    is_in_house bigint NOT NULL,
    email_domain text NOT NULL,
    birthday_from_email text NOT NULL,
    payment_from_email text NOT NULL,
    renewal_from_email text NOT NULL,
    home_url text NOT NULL,
    short_name text NOT NULL,
    seller_required bigint NOT NULL,
    has_compliance bigint NOT NULL,
    default_cc_emails text,
    surnames text NOT NULL,
    type text NOT NULL,
    theme text NOT NULL,
    retirement_date text,
    tenant_id bigint
);
CREATE TABLE savia_core.agency_branches (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    name text NOT NULL,
    is_active bigint NOT NULL,
    agency_id bigint NOT NULL,
    city_id bigint NOT NULL
);
CREATE TABLE savia_core.agency_contacts (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    name text NOT NULL,
    surname text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    "position" text NOT NULL,
    agency_id bigint NOT NULL
);
ALTER TABLE savia_core.agency_contacts ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.agency_contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.tenant_crm_connection_audit_events (
    id text NOT NULL,
    connection_id text NOT NULL,
    tenant_id bigint NOT NULL,
    principal_id text NOT NULL,
    provider text NOT NULL,
    event_type text NOT NULL,
    outcome text NOT NULL,
    error_code text,
    created_at text NOT NULL
);
CREATE VIEW savia_core.agency_crm_connection_audit_events AS
 SELECT id,
    connection_id,
    tenant_id AS agency_id,
    principal_id,
    provider,
    event_type,
    outcome,
    error_code,
    created_at
   FROM savia_core.tenant_crm_connection_audit_events;
CREATE TABLE savia_core.tenant_crm_connections (
    id text NOT NULL,
    tenant_id bigint NOT NULL,
    created_by_principal_id text NOT NULL,
    provider text NOT NULL,
    nango_connection_id text NOT NULL,
    nango_integration_id text NOT NULL,
    status text NOT NULL,
    external_account_label text,
    scopes text DEFAULT '[]'::text NOT NULL,
    last_validated_at text,
    disconnected_at text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    external_account_id text,
    CONSTRAINT agency_crm_connections_provider_check CHECK ((provider = ANY (ARRAY['hubspot'::text, 'salesforce'::text, 'zoho'::text, 'pipedrive'::text]))),
    CONSTRAINT agency_crm_connections_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'connected'::text, 'reconnect_required'::text, 'disconnected'::text, 'failed'::text])))
);
CREATE VIEW savia_core.agency_crm_connections AS
 SELECT id,
    tenant_id AS agency_id,
    created_by_principal_id,
    provider,
    nango_connection_id,
    nango_integration_id,
    status,
    external_account_label,
    scopes,
    last_validated_at,
    disconnected_at,
    created_at,
    updated_at,
    external_account_id
   FROM savia_core.tenant_crm_connections;
CREATE TABLE savia_core.app_economicactivity (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL
);
ALTER TABLE savia_core.app_economicactivity ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.app_economicactivity_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.assistant_active_tenants (
    principal_id text NOT NULL,
    tenant_id bigint NOT NULL,
    updated_at text NOT NULL
);
CREATE VIEW savia_core.assistant_active_agencies AS
 SELECT principal_id,
    tenant_id AS agency_id,
    updated_at
   FROM savia_core.assistant_active_tenants;
CREATE TABLE savia_core.assistant_openrouter_settings (
    id text NOT NULL,
    scope text NOT NULL,
    agency_id bigint,
    api_key_ciphertext text,
    api_key_iv text,
    model text,
    updated_at text NOT NULL,
    updated_by text NOT NULL,
    CONSTRAINT assistant_openrouter_settings_check CHECK ((((scope = 'global'::text) AND (id = 'global'::text) AND (agency_id IS NULL)) OR ((scope = 'agency'::text) AND (id = ('agency:'::text || agency_id)) AND (agency_id IS NOT NULL)))),
    CONSTRAINT assistant_openrouter_settings_check1 CHECK (((api_key_ciphertext IS NULL) = (api_key_iv IS NULL))),
    CONSTRAINT assistant_openrouter_settings_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'agency'::text])))
);
CREATE TABLE savia_core.assistant_pending_actions (
    id text NOT NULL,
    principal_id text NOT NULL,
    domain text NOT NULL,
    command text NOT NULL,
    input_json text NOT NULL,
    status text NOT NULL,
    created_at text NOT NULL,
    expires_at text NOT NULL,
    resolved_at text,
    result_json text,
    CONSTRAINT assistant_pending_actions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'executing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'expired'::text])))
);
CREATE TABLE savia_core.assistant_virtual_employee_chunks (
    id text NOT NULL,
    employee_id text NOT NULL,
    file_id text NOT NULL,
    chunk_index bigint NOT NULL,
    text text NOT NULL,
    vector_id text,
    created_at text NOT NULL
);
CREATE TABLE savia_core.assistant_virtual_employee_files (
    id text NOT NULL,
    employee_id text NOT NULL,
    name text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    r2_key text NOT NULL,
    rag_status text DEFAULT 'indexed'::text NOT NULL,
    created_at text NOT NULL,
    CONSTRAINT assistant_virtual_employee_files_rag_status_check CHECK ((rag_status = ANY (ARRAY['pending'::text, 'indexed'::text, 'failed'::text])))
);
CREATE TABLE savia_core.assistant_virtual_employees (
    id text NOT NULL,
    agency_id bigint,
    name text NOT NULL,
    handle text NOT NULL,
    "position" text,
    avatar text,
    greeting text,
    system_prompt text NOT NULL,
    allowed_collections text DEFAULT '["*"]'::text NOT NULL,
    model text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    created_by text,
    CONSTRAINT assistant_virtual_employees_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);
CREATE TABLE savia_core.attachment_uploads (
    id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    expires_at text NOT NULL,
    agency_id bigint NOT NULL,
    domain text NOT NULL,
    collection text NOT NULL,
    aggregate_id bigint NOT NULL,
    object_key text NOT NULL,
    original_name text NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    sha256 text,
    status text NOT NULL,
    source_table text,
    source_document_id bigint,
    CONSTRAINT attachment_uploads_byte_size_check CHECK ((byte_size > 0)),
    CONSTRAINT attachment_uploads_status_check CHECK ((status = ANY (ARRAY['issued'::text, 'ready'::text, 'rejected'::text, 'discarded'::text])))
);
CREATE TABLE savia_core.auto_light_quote_offers (
    id text NOT NULL,
    quote_request_id text NOT NULL,
    provider text NOT NULL,
    operation_id text NOT NULL,
    attempt_number bigint NOT NULL,
    status text NOT NULL,
    started_at text,
    completed_at text,
    http_status bigint,
    provider_reference text,
    normalized_result text,
    sanitized_response text,
    error_code text,
    error_message text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    credential_owner_principal_id text,
    CONSTRAINT auto_light_quote_offers_attempt_number_check CHECK ((attempt_number > 0)),
    CONSTRAINT auto_light_quote_offers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'successful'::text, 'failed'::text])))
);
CREATE TABLE savia_core.auto_light_quote_requests (
    id text NOT NULL,
    agency_id bigint NOT NULL,
    created_by_principal_id text NOT NULL,
    plate text NOT NULL,
    vehicle_source text NOT NULL,
    vehicle_snapshot text NOT NULL,
    applicant_snapshot text NOT NULL,
    coverage_preferences text NOT NULL,
    status text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT auto_light_quote_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'successful'::text, 'partial'::text, 'failed'::text]))),
    CONSTRAINT auto_light_quote_requests_vehicle_source_check CHECK ((vehicle_source = ANY (ARRAY['equidad'::text, 'sura'::text])))
);
CREATE TABLE savia_core.bundle_flow_state (
    scope text NOT NULL,
    flow_id text NOT NULL,
    bundle_version text NOT NULL,
    content_hash text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.business_commercialunit (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    name text NOT NULL,
    created_by text NOT NULL,
    agency_id bigint NOT NULL,
    edited_by text NOT NULL
);
ALTER TABLE savia_core.business_commercialunit ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.business_commercialunit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.categories (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    name text NOT NULL,
    external_id bigint
);
CREATE TABLE savia_core.cities (
    id bigint NOT NULL,
    name text NOT NULL,
    department_id bigint NOT NULL,
    external_id bigint NOT NULL
);
ALTER TABLE savia_core.cities ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.cities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.countries (
    id bigint NOT NULL,
    name text NOT NULL,
    code text NOT NULL
);
ALTER TABLE savia_core.countries ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.countries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.crm_collection_bindings (
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    source_id text NOT NULL,
    resource text NOT NULL,
    config text NOT NULL,
    CONSTRAINT crm_collection_bindings_config_check CHECK (savia_core.savia_json_valid(config))
);
CREATE TABLE savia_core.crm_sync_changes (
    sequence bigint NOT NULL,
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    id text NOT NULL,
    data text NOT NULL,
    version bigint NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    deleted_at text,
    created_by text
);
ALTER TABLE savia_core.crm_sync_changes ALTER COLUMN sequence ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.crm_sync_changes_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.crm_sync_jobs (
    id text NOT NULL,
    rule_id text NOT NULL,
    customer_id bigint NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    synced_revision bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts bigint DEFAULT 0 NOT NULL,
    next_attempt_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    lease_token text,
    lease_started_at text,
    last_error text,
    external_url text,
    updated_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT crm_sync_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'synced'::text, 'failed'::text, 'blocked'::text])))
);
CREATE TABLE savia_core.crm_sync_mappings (
    rule_id text NOT NULL,
    customer_id bigint NOT NULL,
    object_kind text NOT NULL,
    external_object_id text NOT NULL,
    updated_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT crm_sync_mappings_object_kind_check CHECK ((object_kind = ANY (ARRAY['contact'::text, 'company'::text])))
);
CREATE TABLE savia_core.crm_sync_receipts (
    tenant_id text NOT NULL,
    principal_id text NOT NULL,
    mutation_id text NOT NULL,
    fingerprint text NOT NULL,
    response text NOT NULL,
    before_state text,
    effects_applied bigint DEFAULT 0 NOT NULL
);
CREATE TABLE savia_core.crm_sync_rules (
    id text NOT NULL,
    principal_id text NOT NULL,
    tenant_id bigint NOT NULL,
    provider text NOT NULL,
    connection_id text NOT NULL,
    external_account_id text NOT NULL,
    account_label text NOT NULL,
    enabled bigint DEFAULT 1 NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT crm_sync_rules_enabled_check CHECK ((enabled = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT crm_sync_rules_provider_check CHECK ((provider = ANY (ARRAY['hubspot'::text, 'salesforce'::text, 'zoho'::text, 'pipedrive'::text])))
);
CREATE TABLE savia_core.customer_address (
    id bigint NOT NULL,
    address text NOT NULL,
    city_id bigint NOT NULL,
    coordinates text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    complement text NOT NULL
);
ALTER TABLE savia_core.customer_address ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.customer_address_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.customer_client (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    id_number text NOT NULL,
    migration_slug text NOT NULL,
    external_id text NOT NULL
);
ALTER TABLE savia_core.customer_client ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.customer_client_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.customer_clientagency (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    agency_id bigint NOT NULL,
    client_id bigint NOT NULL,
    created_by text NOT NULL,
    created_by_slug text NOT NULL,
    birthday_notification bigint NOT NULL,
    payment_notification bigint NOT NULL,
    renewal_notification bigint NOT NULL,
    commercial_unit_id bigint,
    group_id bigint,
    document_url text NOT NULL,
    computed_data text NOT NULL,
    completed_at text,
    origin_from_prospects bigint NOT NULL
);
ALTER TABLE savia_core.customer_clientagency ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.customer_clientagency_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.customer_crm_sync_records (
    principal_id text NOT NULL,
    agency_id bigint NOT NULL,
    customer_profile_id bigint NOT NULL,
    provider text NOT NULL,
    object_kind text NOT NULL,
    external_object_id text NOT NULL,
    last_synced_at text,
    last_failure_code text,
    last_failure_at text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT customer_crm_sync_records_object_kind_check CHECK ((object_kind = ANY (ARRAY['contact'::text, 'company'::text]))),
    CONSTRAINT customer_crm_sync_records_provider_check CHECK ((provider = ANY (ARRAY['hubspot'::text, 'salesforce'::text, 'zoho'::text, 'pipedrive'::text])))
);
CREATE TABLE savia_core.customer_group (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    name text NOT NULL,
    agency_id bigint,
    description text NOT NULL
);
ALTER TABLE savia_core.customer_group ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.customer_group_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.customer_legalperson (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    name text NOT NULL,
    id_number text NOT NULL,
    id_check_digit text NOT NULL,
    incorporation_date text,
    lr_name text NOT NULL,
    lr_id_type text NOT NULL,
    lr_id_number text NOT NULL,
    address_id bigint,
    business_activity_id bigint,
    client_id bigint NOT NULL
);
ALTER TABLE savia_core.customer_legalperson ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.customer_legalperson_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.customer_legalpersoncontact (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    surname text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    "position" text NOT NULL,
    legal_person_id bigint NOT NULL,
    is_main bigint NOT NULL,
    name text NOT NULL,
    comments text NOT NULL
);
ALTER TABLE savia_core.customer_legalpersoncontact ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.customer_legalpersoncontact_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.customer_naturalperson (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    surname text NOT NULL,
    birth_date text,
    phone text NOT NULL,
    id_type text NOT NULL,
    id_number text NOT NULL,
    id_issue_at text,
    marital_status text NOT NULL,
    occupation text NOT NULL,
    company text NOT NULL,
    home_address_id bigint,
    work_address_id bigint,
    genre text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    client_id bigint NOT NULL
);
ALTER TABLE savia_core.customer_naturalperson ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.customer_naturalperson_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.departments (
    id bigint NOT NULL,
    name text NOT NULL,
    country_id bigint NOT NULL,
    external_id bigint NOT NULL
);
ALTER TABLE savia_core.departments ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.departments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.document_ownership (
    domain text NOT NULL,
    collection text NOT NULL,
    document_id text NOT NULL,
    agency_id bigint NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.extension_action_runs (
    tenant_id text NOT NULL,
    run_id text NOT NULL,
    extension_id text NOT NULL,
    action_id text NOT NULL,
    connection_id text NOT NULL,
    principal_id text NOT NULL,
    status text NOT NULL,
    input text NOT NULL,
    output text,
    error_code text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT extension_action_runs_input_check CHECK (savia_core.savia_json_valid(input)),
    CONSTRAINT extension_action_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'expired'::text])))
);
CREATE TABLE savia_core.extension_connection_audit_events (
    id text NOT NULL,
    tenant_id text NOT NULL,
    extension_id text NOT NULL,
    connection_id text NOT NULL,
    actor_principal_id text NOT NULL,
    event_type text NOT NULL,
    outcome text NOT NULL,
    error_code text,
    created_at text NOT NULL,
    CONSTRAINT extension_connection_audit_events_outcome_check CHECK ((outcome = ANY (ARRAY['success'::text, 'failure'::text])))
);
CREATE TABLE savia_core.extension_connections (
    tenant_id text NOT NULL,
    extension_id text NOT NULL,
    id text NOT NULL,
    connector_id text NOT NULL,
    credential_ciphertext text NOT NULL,
    credential_iv text NOT NULL,
    created_by_principal_id text NOT NULL,
    updated_by_principal_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.extension_settings (
    tenant_id text NOT NULL,
    extension_id text NOT NULL,
    value text NOT NULL,
    version bigint NOT NULL,
    created_by_principal_id text NOT NULL,
    updated_by_principal_id text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT extension_settings_value_check CHECK (savia_core.savia_json_valid(value))
);
CREATE TABLE savia_core.flow_runs (
    id text NOT NULL,
    flow_id text NOT NULL,
    version_id text,
    mode text NOT NULL,
    status text NOT NULL,
    created_at text NOT NULL,
    summary text NOT NULL
);
CREATE TABLE savia_core.flow_variables (
    flow_id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    secret bigint DEFAULT 0 NOT NULL
);
CREATE TABLE savia_core.flow_versions (
    id text NOT NULL,
    flow_id text NOT NULL,
    definition text NOT NULL,
    created_at text NOT NULL
);
CREATE TABLE savia_core.flows (
    id text NOT NULL,
    definition text NOT NULL
);
CREATE TABLE savia_core.folders (
    path text NOT NULL
);
CREATE TABLE savia_core.identity_global_role (
    principal_id text NOT NULL,
    role text NOT NULL,
    created_at text NOT NULL,
    CONSTRAINT identity_global_role_role_check CHECK ((role = 'platform_admin'::text))
);
CREATE TABLE savia_core.identity_principal (
    id text NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    is_active bigint DEFAULT 1 NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.identity_tenant_membership (
    id text NOT NULL,
    principal_id text NOT NULL,
    tenant_id bigint NOT NULL,
    role text NOT NULL,
    is_active bigint DEFAULT 1 NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT identity_tenant_membership_role_check CHECK ((role = ANY (ARRAY['agency_admin'::text, 'tenant_admin'::text, 'operator'::text, 'viewer'::text])))
);
CREATE TABLE savia_core.installed_bundles (
    id text NOT NULL,
    version text NOT NULL,
    installed_at text NOT NULL
);
CREATE TABLE savia_core.insurer_companies (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    name text NOT NULL,
    id_number text NOT NULL,
    name_long text NOT NULL,
    id_check_digit text NOT NULL,
    external_id bigint,
    reconciliation_type text NOT NULL,
    payment_url text NOT NULL,
    vendu_code text NOT NULL,
    collection_reconciliation_type text NOT NULL,
    payment_information text NOT NULL,
    assistance_line text NOT NULL,
    is_active bigint NOT NULL
);
CREATE TABLE savia_core.legacy_import_snapshots (
    id text NOT NULL,
    created_at text NOT NULL,
    manifest_sha256 text NOT NULL,
    stream_count bigint NOT NULL,
    CONSTRAINT legacy_import_snapshots_stream_count_check CHECK ((stream_count >= 0))
);
CREATE TABLE savia_core.legacy_import_streams (
    snapshot_id text NOT NULL,
    source_type text NOT NULL,
    source_name text NOT NULL,
    destination_prefix text NOT NULL,
    record_count bigint NOT NULL,
    byte_count bigint NOT NULL,
    sha256 text NOT NULL,
    CONSTRAINT legacy_import_streams_byte_count_check CHECK ((byte_count >= 0)),
    CONSTRAINT legacy_import_streams_record_count_check CHECK ((record_count >= 0))
);
CREATE TABLE savia_core.managed_customer_extensions (
    tenant_id text NOT NULL,
    profile_id bigint NOT NULL,
    data text DEFAULT '{}'::text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT managed_customer_extensions_data_check CHECK (savia_core.savia_json_valid(data))
);
CREATE TABLE savia_core.managed_customer_requests (
    tenant_id text NOT NULL,
    request_key text NOT NULL,
    fingerprint text NOT NULL,
    response text NOT NULL,
    CONSTRAINT managed_customer_requests_response_check CHECK (savia_core.savia_json_valid(response))
);
CREATE TABLE savia_core.notification_admin_audit (
    id text NOT NULL,
    workspace_id text NOT NULL,
    actor_id text NOT NULL,
    event_id text NOT NULL,
    action text NOT NULL,
    created_at bigint NOT NULL
);
CREATE TABLE savia_core.notification_deliveries (
    id text NOT NULL,
    event_id text NOT NULL,
    scope_kind text NOT NULL,
    scope_id text NOT NULL,
    recipient_id text NOT NULL,
    channel text DEFAULT 'in-app'::text NOT NULL,
    created_at bigint NOT NULL,
    read_at bigint,
    archived_at bigint,
    resolved_at bigint,
    CONSTRAINT notification_deliveries_channel_check CHECK ((channel = 'in-app'::text))
);
CREATE TABLE savia_core.notification_events (
    id text NOT NULL,
    scope_kind text NOT NULL,
    scope_id text NOT NULL,
    event_key text NOT NULL,
    payload text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint,
    status text DEFAULT 'pending'::text NOT NULL,
    cursor text,
    attempts integer DEFAULT 0 NOT NULL,
    next_retry bigint DEFAULT 0 NOT NULL,
    lease_token text,
    lease_until bigint DEFAULT 0 NOT NULL,
    error text,
    CONSTRAINT notification_events_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['workspace'::text, 'account'::text]))),
    CONSTRAINT notification_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);
CREATE TABLE savia_core.notification_maintenance_checkpoints (
    name text NOT NULL,
    cursor text NOT NULL
);
CREATE TABLE savia_core.notification_recipient_retries (
    event_id text NOT NULL,
    recipient_id text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_retry bigint NOT NULL,
    error text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT notification_recipient_retries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'failed'::text])))
);
CREATE TABLE savia_core.notification_scope_settings (
    workspace_id text NOT NULL,
    read_days integer DEFAULT 90 NOT NULL,
    unread_days integer DEFAULT 180 NOT NULL,
    CONSTRAINT notification_scope_settings_check CHECK ((((unread_days >= 30) AND (unread_days <= 730)) AND (unread_days >= read_days))),
    CONSTRAINT notification_scope_settings_read_days_check CHECK (((read_days >= 7) AND (read_days <= 365)))
);
CREATE TABLE savia_core.notification_send_limits (
    workspace_id text NOT NULL,
    actor_id text NOT NULL,
    window_start bigint NOT NULL,
    count integer NOT NULL,
    CONSTRAINT notification_send_limits_count_check CHECK (((count >= 1) AND (count <= 10)))
);
CREATE TABLE savia_core.notification_subscriptions (
    workspace_id text NOT NULL,
    principal_id text NOT NULL,
    collection text NOT NULL,
    created_at bigint NOT NULL
);
CREATE TABLE savia_core.offline_collection_policies (
    tenant_id bigint NOT NULL,
    collection text NOT NULL,
    is_enabled bigint DEFAULT 1 NOT NULL,
    refresh_seconds bigint DEFAULT 300 NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.personal_integration_audit_events (
    id text NOT NULL,
    connection_id text NOT NULL,
    principal_id text NOT NULL,
    provider text NOT NULL,
    event_type text NOT NULL,
    outcome text NOT NULL,
    error_code text,
    created_at text NOT NULL
);
CREATE TABLE savia_core.personal_integration_connections (
    id text NOT NULL,
    principal_id text NOT NULL,
    provider text NOT NULL,
    nango_connection_id text NOT NULL,
    nango_integration_id text NOT NULL,
    status text NOT NULL,
    external_account_label text,
    external_account_id text,
    scopes text DEFAULT '[]'::text NOT NULL,
    last_validated_at text,
    disconnected_at text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT personal_integration_connections_provider_check CHECK ((provider = ANY (ARRAY['google_drive'::text, 'gmail'::text, 'google_calendar'::text, 'outlook'::text, 'onedrive_personal'::text, 'onedrive_business'::text]))),
    CONSTRAINT personal_integration_connections_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'connected'::text, 'reconnect_required'::text, 'disconnected'::text, 'failed'::text])))
);
CREATE TABLE savia_core.plugin_store_artifacts (
    tenant_id text NOT NULL,
    id text NOT NULL,
    version text NOT NULL,
    manifest text NOT NULL,
    entry_js text NOT NULL,
    store_json text,
    sha256 text NOT NULL,
    size_bytes bigint NOT NULL,
    created_by text,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    updated_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT plugin_store_artifacts_manifest_check CHECK (savia_core.savia_json_valid(manifest)),
    CONSTRAINT plugin_store_artifacts_size_bytes_check CHECK ((size_bytes > 0)),
    CONSTRAINT plugin_store_artifacts_store_json_check CHECK (((store_json IS NULL) OR savia_core.savia_json_valid(store_json)))
);
CREATE TABLE savia_core.public_form_short_links (
    code text NOT NULL,
    form_id text NOT NULL,
    created_at text NOT NULL,
    CONSTRAINT public_form_short_links_code_check CHECK (((length(code) = 16) AND (code !~ '[^a-f0-9]'::text)))
);
CREATE TABLE savia_core.public_form_submissions (
    form_id text NOT NULL,
    submission_id text NOT NULL,
    tenant_id text NOT NULL,
    ip_hash text NOT NULL,
    day text NOT NULL,
    fingerprint text NOT NULL,
    captcha_hash text NOT NULL,
    state text NOT NULL,
    response text,
    created_at text NOT NULL,
    CONSTRAINT public_form_submissions_response_check CHECK (((response IS NULL) OR savia_core.savia_json_valid(response))),
    CONSTRAINT public_form_submissions_state_check CHECK ((state = ANY (ARRAY['reserved'::text, 'complete'::text, 'failed'::text])))
);
CREATE TABLE savia_core.public_forms (
    id text NOT NULL,
    token text NOT NULL,
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    description text,
    fields text NOT NULL,
    snapshot text NOT NULL,
    daily_limit bigint NOT NULL,
    return_result bigint DEFAULT 0 NOT NULL,
    expires_at text,
    revoked_at text,
    created_by text NOT NULL,
    created_at text NOT NULL,
    short_url text,
    logo_image text,
    CONSTRAINT public_forms_daily_limit_check CHECK (((daily_limit >= 1) AND (daily_limit <= 1000))),
    CONSTRAINT public_forms_fields_check CHECK (savia_core.savia_json_valid(fields)),
    CONSTRAINT public_forms_kind_check CHECK ((kind = ANY (ARRAY['record'::text, 'quote'::text]))),
    CONSTRAINT public_forms_return_result_check CHECK ((return_result = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT public_forms_snapshot_check CHECK (savia_core.savia_json_valid(snapshot))
);
CREATE TABLE savia_core.ramos (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    name text NOT NULL,
    sub_ramo_id bigint NOT NULL,
    tax_iva text NOT NULL,
    external_id bigint,
    manage_reinvestment bigint NOT NULL,
    has_monthly_payment bigint NOT NULL,
    allow_custom_renewal_days bigint NOT NULL,
    is_non_renewable bigint NOT NULL,
    insurance_subject_validation text NOT NULL,
    insurance_subject_validation_message text NOT NULL,
    monthly_payment_form_label text NOT NULL,
    compliance_policy_type text NOT NULL
);
CREATE TABLE savia_core.request_page_runs (
    id text NOT NULL,
    principal_id text NOT NULL,
    tenant_id text NOT NULL,
    page_name text NOT NULL,
    action_id text NOT NULL,
    action_label text NOT NULL,
    mode text NOT NULL,
    status text NOT NULL,
    form_values text NOT NULL,
    result text,
    error text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT request_page_runs_mode_check CHECK ((mode = ANY (ARRAY['mock'::text, 'live'::text]))),
    CONSTRAINT request_page_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'complete'::text, 'failed'::text])))
);
CREATE TABLE savia_core.savia_request_audit (
    id text NOT NULL,
    tenant_id text NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    flow_id text,
    detail text,
    created_at text NOT NULL
);
CREATE TABLE savia_core.server_id_sequences (
    resource text NOT NULL,
    next_id bigint NOT NULL
);
CREATE TABLE savia_core.studio_access_deliveries (
    principal_id text NOT NULL,
    scope text NOT NULL,
    revision bigint NOT NULL,
    object_name text NOT NULL,
    record_id text NOT NULL
);
CREATE TABLE savia_core.studio_audit (
    id text NOT NULL,
    tenant_id text NOT NULL,
    action text NOT NULL,
    object_name text NOT NULL,
    record_id text,
    detail text NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL
);
CREATE TABLE savia_core.studio_automation_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    automation_id text NOT NULL,
    object_name text NOT NULL,
    record_id text NOT NULL,
    event_key text NOT NULL,
    status text NOT NULL,
    detail text NOT NULL,
    task_id text,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL
);
CREATE TABLE savia_core.studio_automations (
    id text NOT NULL,
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    name text NOT NULL,
    config text NOT NULL,
    enabled bigint DEFAULT 1 NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT crm_automations_config_check CHECK (savia_core.savia_json_valid(config))
);
CREATE TABLE savia_core.studio_business_links (
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    record_id text NOT NULL,
    connection_id text NOT NULL,
    status text NOT NULL,
    external_object_id text,
    last_synced_at text,
    CONSTRAINT crm_business_links_status_check CHECK ((status = ANY (ARRAY['syncing'::text, 'synced'::text, 'uncertain'::text])))
);
CREATE TABLE savia_core.studio_collection_relations (
    tenant_id text NOT NULL,
    id text NOT NULL,
    source_object text NOT NULL,
    target_object text NOT NULL,
    source_label text NOT NULL,
    target_label text NOT NULL,
    cardinality text NOT NULL,
    source_field text DEFAULT 'id'::text NOT NULL,
    target_field text DEFAULT 'id'::text NOT NULL,
    source_display_field text,
    target_display_field text,
    storage text DEFAULT 'local'::text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT crm_collection_relations_cardinality_check CHECK ((cardinality = ANY (ARRAY['one-to-one'::text, 'one-to-many'::text, 'many-to-many'::text]))),
    CONSTRAINT crm_collection_relations_storage_check CHECK ((storage = ANY (ARRAY['local'::text, 'fields'::text])))
);
CREATE TABLE savia_core.studio_collection_requests (
    tenant_id text NOT NULL,
    request_key text NOT NULL,
    fingerprint text NOT NULL,
    state text NOT NULL,
    response text,
    CONSTRAINT crm_collection_requests_response_check CHECK (((response IS NULL) OR savia_core.savia_json_valid(response))),
    CONSTRAINT crm_collection_requests_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'success'::text])))
);
CREATE TABLE savia_core.studio_collection_sources (
    tenant_id text NOT NULL,
    owner_principal_id text NOT NULL,
    id text NOT NULL,
    label text NOT NULL,
    kind text NOT NULL,
    config text NOT NULL,
    encrypted_secret text,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT crm_collection_sources_config_check CHECK (savia_core.savia_json_valid(config)),
    CONSTRAINT crm_collection_sources_kind_check CHECK ((kind = ANY (ARRAY['jsonapi'::text, 'postgres'::text, 'mysql'::text, 'mssql'::text, 'mongodb'::text])))
);
CREATE TABLE savia_core.studio_collection_versions (
    tenant_id text NOT NULL,
    collection text NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.studio_extension_installations (
    tenant_id text NOT NULL,
    id text NOT NULL,
    version text NOT NULL,
    enabled bigint DEFAULT 1 NOT NULL,
    manifest text NOT NULL,
    installed_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    updated_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT crm_extension_installations_enabled_check CHECK ((enabled = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT crm_extension_installations_manifest_check CHECK (savia_core.savia_json_valid(manifest))
);
CREATE TABLE savia_core.studio_file_drafts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    field_name text NOT NULL,
    name text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    storage_key text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    expires_at text NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL
);
CREATE TABLE savia_core.studio_file_revisions (
    tenant_id text NOT NULL,
    file_id text NOT NULL,
    version bigint NOT NULL,
    storage_key text NOT NULL,
    size bigint NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    created_by text,
    CONSTRAINT crm_file_revisions_size_check CHECK ((size > 0)),
    CONSTRAINT crm_file_revisions_version_check CHECK ((version > 0))
);
CREATE TABLE savia_core.studio_files (
    id text NOT NULL,
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    record_id text NOT NULL,
    name text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    storage_key text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    field_name text DEFAULT ''::text NOT NULL
);
CREATE TABLE savia_core.studio_geocoding_settings (
    tenant_id text NOT NULL,
    encrypted_geoapify_key text,
    updated_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL
);
CREATE TABLE savia_core.studio_integration_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    integration_id text NOT NULL,
    operation_id text NOT NULL,
    method text NOT NULL,
    status text NOT NULL,
    http_status bigint,
    attempts bigint DEFAULT 0 NOT NULL,
    duration_ms bigint DEFAULT 0 NOT NULL,
    error text,
    response text,
    idempotency_key text,
    request_hash text,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL
);
CREATE TABLE savia_core.studio_integrations (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    document text NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    connection text DEFAULT '{}'::text NOT NULL,
    encrypted_secret text,
    owner_principal_id text DEFAULT ''::text NOT NULL,
    CONSTRAINT crm_integrations_document_check CHECK (savia_core.savia_json_valid(document))
);
CREATE TABLE savia_core.studio_native_relation_overrides (
    tenant_id text NOT NULL,
    id text NOT NULL,
    config text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT crm_native_relation_overrides_config_check CHECK (savia_core.savia_json_valid(config))
);
CREATE TABLE savia_core.studio_notes (
    id text NOT NULL,
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    record_id text NOT NULL,
    body text NOT NULL,
    kind text DEFAULT 'note'::text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL
);
CREATE TABLE savia_core.studio_objects (
    tenant_id text NOT NULL,
    name text NOT NULL,
    label text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    config text NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT crm_objects_config_check CHECK (savia_core.savia_json_valid(config))
);
CREATE TABLE savia_core.studio_record_history (
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    record_id text NOT NULL,
    version bigint NOT NULL,
    action text NOT NULL,
    created_at text NOT NULL,
    actor_kind text NOT NULL,
    actor_id text,
    cause_id text,
    changes text NOT NULL,
    expires_at text NOT NULL,
    CONSTRAINT crm_record_history_action_check CHECK ((action = ANY (ARRAY['created'::text, 'updated'::text, 'deleted'::text, 'restored'::text]))),
    CONSTRAINT crm_record_history_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['user'::text, 'workflow'::text, 'public-form'::text, 'system'::text]))),
    CONSTRAINT crm_record_history_changes_check CHECK (savia_core.savia_json_valid(changes))
);
CREATE TABLE savia_core.studio_record_history_context (
    tenant_id text NOT NULL,
    actor_kind text NOT NULL,
    actor_id text,
    cause_id text
);
CREATE VIEW savia_core.studio_record_history_fields AS
 SELECT o.tenant_id,
    o.name AS object_name,
    f.key AS field_name,
    (LEAST((365)::numeric, GREATEST((1)::numeric,
        CASE
            WHEN (((o.config)::jsonb #>> '{studio,history,retentionDays}'::text[]) IS NULL) THEN (90)::numeric
            WHEN (((o.config)::jsonb #> '{studio,history,retentionDays}'::text[]) = 'true'::jsonb) THEN (1)::numeric
            ELSE (COALESCE("substring"(((o.config)::jsonb #>> '{studio,history,retentionDays}'::text[]), '^[[:space:]]*([+-]?[0-9]+)'::text), '0'::text))::numeric
        END)))::integer AS retention_days
   FROM (savia_core.studio_objects o
     CROSS JOIN LATERAL jsonb_each(
        CASE
            WHEN (jsonb_typeof(((o.config)::jsonb -> 'fields'::text)) = 'object'::text) THEN ((o.config)::jsonb -> 'fields'::text)
            ELSE '{}'::jsonb
        END) f(key, value))
  WHERE ((((o.config)::jsonb #> '{studio,history,enabled}'::text[]) = ANY (ARRAY['true'::jsonb, '1'::jsonb])) AND (((o.config)::jsonb #> '{studio,collection}'::text[]) IS NULL) AND (COALESCE(((o.config)::jsonb #>> '{studio,business}'::text[]), ''::text) <> ALL (ARRAY['managed-customer'::text, 'managed-agency'::text])) AND (jsonb_typeof(((o.config)::jsonb #> '{studio,history,fields}'::text[])) = 'array'::text) AND (f.key IN ( SELECT (chosen.value #>> '{}'::text[])
           FROM jsonb_array_elements(
                CASE
                    WHEN (jsonb_typeof(((o.config)::jsonb #> '{studio,history,fields}'::text[])) = 'array'::text) THEN ((o.config)::jsonb #> '{studio,history,fields}'::text[])
                    ELSE '[]'::jsonb
                END) WITH ORDINALITY chosen(value, ordinality)
          WHERE ((jsonb_typeof(chosen.value) = 'string'::text) AND (chosen.ordinality <= 50)))) AND (f.key !~ '[^A-Za-z0-9_]'::text) AND ("left"(f.key, 1) <> '_'::text) AND (f.key <> ALL (ARRAY['id'::text, 'created_at'::text, 'updated_at'::text, 'deleted_at'::text, 'created_by'::text, 'updated_by'::text, 'createdAt'::text, 'updatedAt'::text, 'deletedAt'::text, 'createdBy'::text, 'updatedBy'::text, 'constructor'::text, 'prototype'::text])) AND ((f.value ->> 'type'::text) = ANY (ARRAY['Textbox'::text, 'Textarea'::text, 'Email'::text, 'Phone'::text, 'Url'::text, 'Address'::text, 'Number'::text, 'Currency'::text, 'Dropdown'::text, 'Autocomplete'::text, 'Toggle'::text, 'DateControl'::text])) AND (COALESCE((f.value -> 'hidden'::text), '0'::jsonb) = ANY (ARRAY['0'::jsonb, 'false'::jsonb, 'null'::jsonb])) AND (COALESCE((f.value -> 'readOnly'::text), '0'::jsonb) = ANY (ARRAY['0'::jsonb, 'false'::jsonb, 'null'::jsonb])) AND (COALESCE((f.value #> '{config,sensitive}'::text[]), '0'::jsonb) = ANY (ARRAY['0'::jsonb, 'false'::jsonb, 'null'::jsonb])) AND (COALESCE((f.value #> '{config,readable}'::text[]), '1'::jsonb) <> ALL (ARRAY['0'::jsonb, 'false'::jsonb])) AND (COALESCE((f.value -> 'readable'::text), '1'::jsonb) <> ALL (ARRAY['0'::jsonb, 'false'::jsonb])) AND (COALESCE((f.value #> '{config,multiple}'::text[]), '0'::jsonb) = ANY (ARRAY['0'::jsonb, 'false'::jsonb, 'null'::jsonb])) AND (((f.value #> '{config,formula}'::text[]) IS NULL) OR ((f.value #> '{config,formula}'::text[]) = 'null'::jsonb)) AND (((f.value #> '{config,relation}'::text[]) IS NULL) OR ((f.value #> '{config,relation}'::text[]) = 'null'::jsonb)) AND (((f.value #> '{config,collectionRelation}'::text[]) IS NULL) OR ((f.value #> '{config,collectionRelation}'::text[]) = 'null'::jsonb)) AND (((f.value #> '{config,collectionRelationTarget}'::text[]) IS NULL) OR ((f.value #> '{config,collectionRelationTarget}'::text[]) = 'null'::jsonb)));
CREATE TABLE savia_core.studio_record_links (
    tenant_id text NOT NULL,
    relation_id text NOT NULL,
    source_id text NOT NULL,
    target_id text NOT NULL
);
CREATE TABLE savia_core.studio_records (
    id text NOT NULL,
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    data text NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    updated_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    deleted_at text,
    created_by text,
    CONSTRAINT crm_records_data_check CHECK (savia_core.savia_json_valid(data))
);
CREATE TABLE savia_core.studio_requests (
    tenant_id text NOT NULL,
    request_key text NOT NULL,
    fingerprint text NOT NULL,
    response text NOT NULL
);
CREATE TABLE savia_core.studio_schema_data (
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    version bigint NOT NULL,
    record_id text NOT NULL,
    data text NOT NULL
);
CREATE TABLE savia_core.studio_schema_versions (
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    version bigint NOT NULL,
    definition text NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL
);
CREATE TABLE savia_core.studio_settings (
    tenant_id text NOT NULL,
    menu_layout text,
    updated_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT crm_studio_settings_menu_layout_check CHECK (((menu_layout IS NULL) OR savia_core.savia_json_valid(menu_layout)))
);
CREATE TABLE savia_core.studio_solution_installations (
    tenant_id text NOT NULL,
    id text NOT NULL,
    version text NOT NULL,
    enabled bigint DEFAULT 1 NOT NULL,
    manifest text NOT NULL,
    installed_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    updated_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT crm_solution_installations_enabled_check CHECK ((enabled = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT crm_solution_installations_manifest_check CHECK (savia_core.savia_json_valid(manifest))
);
CREATE TABLE savia_core.studio_solution_objects (
    tenant_id text NOT NULL,
    solution_id text NOT NULL,
    object_name text NOT NULL,
    definition text NOT NULL,
    CONSTRAINT crm_solution_objects_definition_check CHECK (savia_core.savia_json_valid(definition))
);
CREATE TABLE savia_core.studio_tasks (
    id text NOT NULL,
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    record_id text NOT NULL,
    title text NOT NULL,
    owner text DEFAULT ''::text NOT NULL,
    due_at text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    created_at text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL
);
CREATE TABLE savia_core.studio_unique_values (
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    field_name text NOT NULL,
    value text NOT NULL,
    record_id text NOT NULL
);
CREATE TABLE savia_core.studio_views (
    id text NOT NULL,
    tenant_id text NOT NULL,
    object_name text NOT NULL,
    name text NOT NULL,
    config text NOT NULL,
    CONSTRAINT crm_views_config_check CHECK (savia_core.savia_json_valid(config))
);
CREATE TABLE savia_core.studio_write_guards (
    id text NOT NULL,
    valid bigint NOT NULL,
    CONSTRAINT crm_write_guards_valid_check CHECK ((valid = 1))
);
CREATE TABLE savia_core.sub_ramos (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    name text NOT NULL,
    category_id bigint NOT NULL,
    external_ids text
);
CREATE TABLE savia_core.tenant_branding (
    tenant_id bigint NOT NULL,
    config text NOT NULL,
    version bigint NOT NULL,
    updated_by text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT tenant_branding_config_check CHECK (savia_core.savia_json_valid(config)),
    CONSTRAINT tenant_branding_version_check CHECK ((version > 0))
);
CREATE TABLE savia_core.tenant_branding_assets (
    id text NOT NULL,
    tenant_id bigint NOT NULL,
    kind text NOT NULL,
    object_key text NOT NULL,
    state text DEFAULT 'live'::text NOT NULL,
    content_type text NOT NULL,
    size bigint NOT NULL,
    created_by text NOT NULL,
    created_at text NOT NULL,
    CONSTRAINT tenant_branding_assets_content_type_check CHECK ((content_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/webp'::text, 'application/json'::text]))),
    CONSTRAINT tenant_branding_assets_kind_check CHECK ((kind = ANY (ARRAY['logo'::text, 'cover'::text, 'login-animation'::text]))),
    CONSTRAINT tenant_branding_assets_size_check CHECK (((size > 0) AND (size <= 2097152))),
    CONSTRAINT tenant_branding_assets_state_check CHECK ((state = ANY (ARRAY['live'::text, 'uploading'::text, 'deleting'::text])))
);
ALTER TABLE savia_core.tenant_branding ALTER COLUMN tenant_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.tenant_branding_tenant_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.tenant_bundles (
    tenant_id text NOT NULL,
    id text NOT NULL,
    version text NOT NULL,
    installed_at text NOT NULL
);
CREATE TABLE savia_core.tenant_consolidation_agency_bootstraps (
    target_tenant_id bigint NOT NULL,
    source_tenant_id bigint NOT NULL,
    temporary_short_name text NOT NULL
);
ALTER TABLE savia_core.tenant_consolidation_agency_bootstraps ALTER COLUMN target_tenant_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.tenant_consolidation_agency_bootstraps_target_tenant_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.tenant_consolidation_discards (
    source_tenant_id bigint NOT NULL,
    target_tenant_id bigint NOT NULL,
    table_name text NOT NULL,
    record_key text NOT NULL,
    discarded_at text NOT NULL
);
CREATE TABLE savia_core.tenant_consolidation_sources (
    source_tenant_id bigint NOT NULL,
    target_tenant_id bigint NOT NULL,
    consolidated_at text NOT NULL
);
ALTER TABLE savia_core.tenant_consolidation_sources ALTER COLUMN source_tenant_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.tenant_consolidation_sources_source_tenant_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.tenant_flow_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    flow_id text NOT NULL,
    version_id text,
    mode text NOT NULL,
    status text NOT NULL,
    created_at text NOT NULL,
    summary text NOT NULL
);
CREATE TABLE savia_core.tenant_flow_variables (
    tenant_id text NOT NULL,
    flow_id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    secret bigint DEFAULT 0 NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.tenant_flow_versions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    flow_id text NOT NULL,
    definition text NOT NULL,
    created_at text NOT NULL
);
CREATE TABLE savia_core.tenant_flows (
    tenant_id text NOT NULL,
    flow_id text NOT NULL,
    definition text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.tenant_folders (
    tenant_id text NOT NULL,
    path text NOT NULL
);
CREATE TABLE savia_core.tenant_namespace_migrations (
    old_key text NOT NULL,
    tenant_id bigint NOT NULL
);
CREATE TABLE savia_core.tenants (
    id bigint NOT NULL,
    id_slug text NOT NULL,
    name text NOT NULL,
    is_active bigint DEFAULT 1 NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    kind text DEFAULT 'commercial'::text NOT NULL,
    CONSTRAINT tenants_is_active_check CHECK ((is_active = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT tenants_kind_check CHECK ((kind = ANY (ARRAY['commercial'::text, 'platform'::text])))
);
CREATE TABLE savia_core.user_appearance_preferences (
    principal_id text NOT NULL,
    settings text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.user_my_day_widgets (
    principal_id text NOT NULL,
    layout text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.user_navigation_preferences (
    principal_id text NOT NULL,
    layout text NOT NULL,
    updated_at text NOT NULL
);
CREATE TABLE savia_core.user_provider_credential_audit_events (
    id text NOT NULL,
    owner_principal_id text NOT NULL,
    provider text NOT NULL,
    actor_principal_id text NOT NULL,
    event_type text NOT NULL,
    outcome text NOT NULL,
    error_code text,
    created_at text NOT NULL,
    CONSTRAINT user_provider_credential_audit_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'replaced'::text, 'revealed'::text, 'tested'::text, 'deleted'::text])))
);
CREATE TABLE savia_core.user_provider_credentials (
    id text NOT NULL,
    owner_principal_id text NOT NULL,
    provider text NOT NULL,
    schema_version bigint NOT NULL,
    credential_ciphertext text NOT NULL,
    credential_iv text NOT NULL,
    last_validation_status text,
    last_validation_error_code text,
    last_validated_at text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    created_by_principal_id text NOT NULL,
    updated_by_principal_id text NOT NULL,
    CONSTRAINT user_provider_credentials_last_validation_status_check CHECK (((last_validation_status = ANY (ARRAY['valid'::text, 'invalid'::text])) OR (last_validation_status IS NULL))),
    CONSTRAINT user_provider_credentials_schema_version_check CHECK ((schema_version > 0))
);
CREATE TABLE savia_core.workflow_events (
    id bigint NOT NULL,
    workspace_id text NOT NULL,
    collection text NOT NULL,
    kind text NOT NULL,
    before_state text NOT NULL,
    after_state text NOT NULL,
    depth bigint DEFAULT 0 NOT NULL,
    cause text,
    created_at text DEFAULT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL
);
ALTER TABLE savia_core.workflow_events ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME savia_core.workflow_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE savia_core.workflow_executions (
    workspace_id text NOT NULL,
    id text NOT NULL,
    workflow_id text NOT NULL,
    version_id text NOT NULL,
    owner_id text NOT NULL,
    initiator_id text NOT NULL,
    event_key text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    node_id text,
    context text NOT NULL,
    depth bigint DEFAULT 0 NOT NULL,
    wake_at bigint DEFAULT 0 NOT NULL,
    lease_token text,
    lease_until bigint DEFAULT 0 NOT NULL,
    attempts bigint DEFAULT 0 NOT NULL,
    error text,
    created_at text DEFAULT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL,
    updated_at text DEFAULT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL,
    CONSTRAINT workflow_executions_context_check CHECK (savia_core.savia_json_valid(context)),
    CONSTRAINT workflow_executions_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'waiting'::text, 'completed'::text, 'failed'::text, 'blocked'::text, 'cancelled'::text])))
);
CREATE TABLE savia_core.workflow_jobs (
    workspace_id text NOT NULL,
    execution_id text NOT NULL,
    node_id text NOT NULL,
    sequence bigint NOT NULL,
    type text NOT NULL,
    input text NOT NULL,
    output text NOT NULL,
    attempts bigint NOT NULL,
    created_at text DEFAULT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL
);
CREATE TABLE savia_core.workflow_tasks (
    workspace_id text NOT NULL,
    id text NOT NULL,
    execution_id text NOT NULL,
    node_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    assignee text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    due_at bigint,
    created_at text DEFAULT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL,
    CONSTRAINT workflow_tasks_kind_check CHECK ((kind = ANY (ARRAY['task'::text, 'notification'::text]))),
    CONSTRAINT workflow_tasks_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text])))
);
CREATE TABLE savia_core.workflow_versions (
    workspace_id text NOT NULL,
    id text NOT NULL,
    workflow_id text NOT NULL,
    definition text NOT NULL,
    owner_id text NOT NULL,
    revision bigint NOT NULL,
    created_at text DEFAULT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL,
    CONSTRAINT workflow_versions_definition_check CHECK (savia_core.savia_json_valid(definition))
);
CREATE TABLE savia_core.workflow_webhook_admissions (
    endpoint_id text NOT NULL,
    minute bigint NOT NULL,
    count bigint NOT NULL,
    CONSTRAINT workflow_webhook_admissions_count_check CHECK (((count >= 1) AND (count <= 60)))
);
CREATE TABLE savia_core.workflow_webhook_attempts (
    workspace_id text NOT NULL,
    execution_id text NOT NULL,
    node_id text NOT NULL,
    sequence bigint NOT NULL,
    lease_token text NOT NULL,
    started_at bigint NOT NULL,
    finished_at bigint,
    status bigint,
    error text,
    output text
);
CREATE TABLE savia_core.workflow_webhook_deliveries (
    workspace_id text NOT NULL,
    execution_id text NOT NULL,
    node_id text NOT NULL,
    destination_id text NOT NULL,
    destination_revision bigint NOT NULL,
    payload text NOT NULL,
    stable_key text NOT NULL,
    attempt_count bigint DEFAULT 0 NOT NULL,
    retry_generation bigint DEFAULT 0 NOT NULL,
    generation_attempts bigint DEFAULT 0 NOT NULL,
    state text DEFAULT 'prepared'::text NOT NULL
);
CREATE TABLE savia_core.workflow_webhook_destination_versions (
    workspace_id text NOT NULL,
    id text NOT NULL,
    revision bigint NOT NULL,
    url text NOT NULL,
    auth_type text NOT NULL,
    auth_header text
);
CREATE TABLE savia_core.workflow_webhook_destinations (
    workspace_id text NOT NULL,
    id text NOT NULL,
    name text NOT NULL,
    current_revision bigint NOT NULL,
    enabled bigint DEFAULT 1 NOT NULL,
    encrypted_secret text,
    credential_type text NOT NULL,
    credential_header text
);
CREATE TABLE savia_core.workflow_webhook_endpoints (
    workspace_id text NOT NULL,
    id text NOT NULL,
    workflow_id text NOT NULL,
    secret_hash text NOT NULL
);
CREATE TABLE savia_core.workflow_webhook_receipts (
    workspace_id text NOT NULL,
    endpoint_id text NOT NULL,
    event_key text NOT NULL,
    payload_hash text NOT NULL,
    execution_id text NOT NULL
);
CREATE TABLE savia_core.workflow_write_context (
    workspace_id text NOT NULL,
    record_id text NOT NULL,
    depth bigint NOT NULL,
    cause text NOT NULL
);
CREATE TABLE savia_core.workflows (
    workspace_id text NOT NULL,
    id text NOT NULL,
    name text NOT NULL,
    definition text NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    enabled bigint DEFAULT 0 NOT NULL,
    published_version text,
    created_by text NOT NULL,
    next_run_at bigint,
    created_at text DEFAULT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL,
    CONSTRAINT workflows_definition_check CHECK (savia_core.savia_json_valid(definition))
);
ALTER TABLE ONLY savia_core.access_assignments
    ADD CONSTRAINT access_assignments_pkey PRIMARY KEY (scope, principal_id, role_id);
ALTER TABLE ONLY savia_core.access_audit
    ADD CONSTRAINT access_audit_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.access_grants
    ADD CONSTRAINT access_grants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.access_revisions
    ADD CONSTRAINT access_revisions_pkey PRIMARY KEY (scope);
ALTER TABLE ONLY savia_core.access_roles
    ADD CONSTRAINT access_roles_pkey PRIMARY KEY (scope, id);
ALTER TABLE ONLY savia_core.access_roles
    ADD CONSTRAINT access_roles_scope_name_key UNIQUE (scope, name);
ALTER TABLE ONLY savia_core.admin_oauth_transactions
    ADD CONSTRAINT admin_oauth_transactions_pkey PRIMARY KEY (state);
ALTER TABLE ONLY savia_core.agencies
    ADD CONSTRAINT agencies_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.agency_branches
    ADD CONSTRAINT agency_branches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.agency_contacts
    ADD CONSTRAINT agency_contacts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.tenant_crm_connection_audit_events
    ADD CONSTRAINT agency_crm_connection_audit_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.tenant_crm_connections
    ADD CONSTRAINT agency_crm_connections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.app_economicactivity
    ADD CONSTRAINT app_economicactivity_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.assistant_active_tenants
    ADD CONSTRAINT assistant_active_agencies_pkey PRIMARY KEY (principal_id);
ALTER TABLE ONLY savia_core.assistant_openrouter_settings
    ADD CONSTRAINT assistant_openrouter_settings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.assistant_pending_actions
    ADD CONSTRAINT assistant_pending_actions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.assistant_virtual_employee_chunks
    ADD CONSTRAINT assistant_virtual_employee_chunks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.assistant_virtual_employee_files
    ADD CONSTRAINT assistant_virtual_employee_files_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.assistant_virtual_employees
    ADD CONSTRAINT assistant_virtual_employees_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.attachment_uploads
    ADD CONSTRAINT attachment_uploads_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.auto_light_quote_offers
    ADD CONSTRAINT auto_light_quote_offers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.auto_light_quote_offers
    ADD CONSTRAINT auto_light_quote_offers_request_operation_attempt_unique UNIQUE (quote_request_id, operation_id, attempt_number);
ALTER TABLE ONLY savia_core.auto_light_quote_requests
    ADD CONSTRAINT auto_light_quote_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.bundle_flow_state
    ADD CONSTRAINT bundle_flow_state_pkey PRIMARY KEY (scope, flow_id);
ALTER TABLE ONLY savia_core.business_commercialunit
    ADD CONSTRAINT business_commercialunit_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.countries
    ADD CONSTRAINT countries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_access_deliveries
    ADD CONSTRAINT crm_access_deliveries_pkey PRIMARY KEY (principal_id, scope, revision, object_name, record_id);
ALTER TABLE ONLY savia_core.studio_audit
    ADD CONSTRAINT crm_audit_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_automation_runs
    ADD CONSTRAINT crm_automation_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_automation_runs
    ADD CONSTRAINT crm_automation_runs_tenant_id_automation_id_event_key_key UNIQUE (tenant_id, automation_id, event_key);
ALTER TABLE ONLY savia_core.studio_automations
    ADD CONSTRAINT crm_automations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_business_links
    ADD CONSTRAINT crm_business_links_pkey PRIMARY KEY (tenant_id, object_name, record_id, connection_id);
ALTER TABLE ONLY savia_core.crm_collection_bindings
    ADD CONSTRAINT crm_collection_bindings_pkey PRIMARY KEY (tenant_id, object_name);
ALTER TABLE ONLY savia_core.studio_collection_relations
    ADD CONSTRAINT crm_collection_relations_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE ONLY savia_core.studio_collection_requests
    ADD CONSTRAINT crm_collection_requests_pkey PRIMARY KEY (tenant_id, request_key);
ALTER TABLE ONLY savia_core.studio_collection_sources
    ADD CONSTRAINT crm_collection_sources_pkey PRIMARY KEY (tenant_id, owner_principal_id, id);
ALTER TABLE ONLY savia_core.studio_collection_versions
    ADD CONSTRAINT crm_collection_versions_pkey PRIMARY KEY (tenant_id, collection);
ALTER TABLE ONLY savia_core.studio_extension_installations
    ADD CONSTRAINT crm_extension_installations_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE ONLY savia_core.studio_file_drafts
    ADD CONSTRAINT crm_file_drafts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_file_drafts
    ADD CONSTRAINT crm_file_drafts_storage_key_key UNIQUE (storage_key);
ALTER TABLE ONLY savia_core.studio_file_revisions
    ADD CONSTRAINT crm_file_revisions_pkey PRIMARY KEY (tenant_id, file_id, version);
ALTER TABLE ONLY savia_core.studio_file_revisions
    ADD CONSTRAINT crm_file_revisions_storage_key_key UNIQUE (storage_key);
ALTER TABLE ONLY savia_core.studio_files
    ADD CONSTRAINT crm_files_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_files
    ADD CONSTRAINT crm_files_storage_key_key UNIQUE (storage_key);
ALTER TABLE ONLY savia_core.studio_geocoding_settings
    ADD CONSTRAINT crm_geocoding_settings_pkey PRIMARY KEY (tenant_id);
ALTER TABLE ONLY savia_core.studio_integration_runs
    ADD CONSTRAINT crm_integration_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_integrations
    ADD CONSTRAINT crm_integrations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_native_relation_overrides
    ADD CONSTRAINT crm_native_relation_overrides_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE ONLY savia_core.studio_notes
    ADD CONSTRAINT crm_notes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_objects
    ADD CONSTRAINT crm_objects_pkey PRIMARY KEY (tenant_id, name);
ALTER TABLE ONLY savia_core.studio_record_history_context
    ADD CONSTRAINT crm_record_history_context_pkey PRIMARY KEY (tenant_id);
ALTER TABLE ONLY savia_core.studio_record_history
    ADD CONSTRAINT crm_record_history_pkey PRIMARY KEY (tenant_id, object_name, record_id, version);
ALTER TABLE ONLY savia_core.studio_record_links
    ADD CONSTRAINT crm_record_links_pkey PRIMARY KEY (tenant_id, relation_id, source_id, target_id);
ALTER TABLE ONLY savia_core.studio_records
    ADD CONSTRAINT crm_records_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE ONLY savia_core.studio_requests
    ADD CONSTRAINT crm_requests_pkey PRIMARY KEY (tenant_id, request_key);
ALTER TABLE ONLY savia_core.studio_schema_data
    ADD CONSTRAINT crm_schema_data_pkey PRIMARY KEY (tenant_id, object_name, version, record_id);
ALTER TABLE ONLY savia_core.studio_schema_versions
    ADD CONSTRAINT crm_schema_versions_pkey PRIMARY KEY (tenant_id, object_name, version);
ALTER TABLE ONLY savia_core.studio_solution_installations
    ADD CONSTRAINT crm_solution_installations_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE ONLY savia_core.studio_solution_objects
    ADD CONSTRAINT crm_solution_objects_pkey PRIMARY KEY (tenant_id, object_name);
ALTER TABLE ONLY savia_core.studio_settings
    ADD CONSTRAINT crm_studio_settings_pkey PRIMARY KEY (tenant_id);
ALTER TABLE ONLY savia_core.crm_sync_changes
    ADD CONSTRAINT crm_sync_changes_pkey PRIMARY KEY (sequence);
ALTER TABLE ONLY savia_core.crm_sync_changes
    ADD CONSTRAINT crm_sync_changes_tenant_id_object_name_id_key UNIQUE (tenant_id, object_name, id);
ALTER TABLE ONLY savia_core.crm_sync_jobs
    ADD CONSTRAINT crm_sync_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.crm_sync_jobs
    ADD CONSTRAINT crm_sync_jobs_rule_id_customer_id_key UNIQUE (rule_id, customer_id);
ALTER TABLE ONLY savia_core.crm_sync_mappings
    ADD CONSTRAINT crm_sync_mappings_pkey PRIMARY KEY (rule_id, customer_id, object_kind);
ALTER TABLE ONLY savia_core.crm_sync_receipts
    ADD CONSTRAINT crm_sync_receipts_pkey PRIMARY KEY (tenant_id, principal_id, mutation_id);
ALTER TABLE ONLY savia_core.crm_sync_rules
    ADD CONSTRAINT crm_sync_rules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.crm_sync_rules
    ADD CONSTRAINT crm_sync_rules_principal_id_tenant_id_provider_connection_i_key UNIQUE (principal_id, tenant_id, provider, connection_id, external_account_id);
ALTER TABLE ONLY savia_core.studio_tasks
    ADD CONSTRAINT crm_tasks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_unique_values
    ADD CONSTRAINT crm_unique_values_pkey PRIMARY KEY (tenant_id, object_name, field_name, value);
ALTER TABLE ONLY savia_core.studio_views
    ADD CONSTRAINT crm_views_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.studio_write_guards
    ADD CONSTRAINT crm_write_guards_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.customer_address
    ADD CONSTRAINT customer_address_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.customer_client
    ADD CONSTRAINT customer_client_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.customer_clientagency
    ADD CONSTRAINT customer_clientagency_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.customer_crm_sync_records
    ADD CONSTRAINT customer_crm_sync_records_pkey PRIMARY KEY (principal_id, agency_id, customer_profile_id, provider, object_kind);
ALTER TABLE ONLY savia_core.customer_group
    ADD CONSTRAINT customer_group_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.customer_legalperson
    ADD CONSTRAINT customer_legalperson_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.customer_legalpersoncontact
    ADD CONSTRAINT customer_legalpersoncontact_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.customer_naturalperson
    ADD CONSTRAINT customer_naturalperson_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.document_ownership
    ADD CONSTRAINT document_ownership_pkey PRIMARY KEY (domain, collection, document_id);
ALTER TABLE ONLY savia_core.extension_action_runs
    ADD CONSTRAINT extension_action_runs_pkey PRIMARY KEY (tenant_id, run_id);
ALTER TABLE ONLY savia_core.extension_connection_audit_events
    ADD CONSTRAINT extension_connection_audit_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.extension_connections
    ADD CONSTRAINT extension_connections_pkey PRIMARY KEY (tenant_id, extension_id, id);
ALTER TABLE ONLY savia_core.extension_settings
    ADD CONSTRAINT extension_settings_pkey PRIMARY KEY (tenant_id, extension_id);
ALTER TABLE ONLY savia_core.flow_runs
    ADD CONSTRAINT flow_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.flow_variables
    ADD CONSTRAINT flow_variables_pkey PRIMARY KEY (flow_id, key);
ALTER TABLE ONLY savia_core.flow_versions
    ADD CONSTRAINT flow_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.flows
    ADD CONSTRAINT flows_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (path);
ALTER TABLE ONLY savia_core.identity_global_role
    ADD CONSTRAINT identity_global_role_pkey PRIMARY KEY (principal_id, role);
ALTER TABLE ONLY savia_core.identity_principal
    ADD CONSTRAINT identity_principal_issuer_subject_unique UNIQUE (issuer, subject);
ALTER TABLE ONLY savia_core.identity_principal
    ADD CONSTRAINT identity_principal_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.identity_tenant_membership
    ADD CONSTRAINT identity_tenant_membership_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.identity_tenant_membership
    ADD CONSTRAINT identity_tenant_membership_principal_id_key UNIQUE (principal_id);
ALTER TABLE ONLY savia_core.installed_bundles
    ADD CONSTRAINT installed_bundles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.insurer_companies
    ADD CONSTRAINT insurer_companies_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.legacy_import_snapshots
    ADD CONSTRAINT legacy_import_snapshots_manifest_sha256_key UNIQUE (manifest_sha256);
ALTER TABLE ONLY savia_core.legacy_import_snapshots
    ADD CONSTRAINT legacy_import_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.legacy_import_streams
    ADD CONSTRAINT legacy_import_streams_pkey PRIMARY KEY (snapshot_id, source_type, source_name);
ALTER TABLE ONLY savia_core.managed_customer_extensions
    ADD CONSTRAINT managed_customer_extensions_pkey PRIMARY KEY (tenant_id, profile_id);
ALTER TABLE ONLY savia_core.managed_customer_requests
    ADD CONSTRAINT managed_customer_requests_pkey PRIMARY KEY (tenant_id, request_key);
ALTER TABLE ONLY savia_core.notification_admin_audit
    ADD CONSTRAINT notification_admin_audit_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.notification_deliveries
    ADD CONSTRAINT notification_deliveries_event_id_recipient_id_channel_key UNIQUE (event_id, recipient_id, channel);
ALTER TABLE ONLY savia_core.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.notification_events
    ADD CONSTRAINT notification_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.notification_events
    ADD CONSTRAINT notification_events_scope_kind_scope_id_event_key_key UNIQUE (scope_kind, scope_id, event_key);
ALTER TABLE ONLY savia_core.notification_maintenance_checkpoints
    ADD CONSTRAINT notification_maintenance_checkpoints_pkey PRIMARY KEY (name);
ALTER TABLE ONLY savia_core.notification_recipient_retries
    ADD CONSTRAINT notification_recipient_retries_pkey PRIMARY KEY (event_id, recipient_id);
ALTER TABLE ONLY savia_core.notification_scope_settings
    ADD CONSTRAINT notification_scope_settings_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY savia_core.notification_send_limits
    ADD CONSTRAINT notification_send_limits_pkey PRIMARY KEY (workspace_id, actor_id, window_start);
ALTER TABLE ONLY savia_core.notification_subscriptions
    ADD CONSTRAINT notification_subscriptions_pkey PRIMARY KEY (workspace_id, principal_id, collection);
ALTER TABLE ONLY savia_core.offline_collection_policies
    ADD CONSTRAINT offline_collection_policies_pkey PRIMARY KEY (tenant_id, collection);
ALTER TABLE ONLY savia_core.personal_integration_audit_events
    ADD CONSTRAINT personal_integration_audit_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.personal_integration_connections
    ADD CONSTRAINT personal_integration_connections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.plugin_store_artifacts
    ADD CONSTRAINT plugin_store_artifacts_pkey PRIMARY KEY (tenant_id, id, version);
ALTER TABLE ONLY savia_core.public_form_short_links
    ADD CONSTRAINT public_form_short_links_form_id_key UNIQUE (form_id);
ALTER TABLE ONLY savia_core.public_form_short_links
    ADD CONSTRAINT public_form_short_links_pkey PRIMARY KEY (code);
ALTER TABLE ONLY savia_core.public_form_submissions
    ADD CONSTRAINT public_form_submissions_captcha_hash_key UNIQUE (captcha_hash);
ALTER TABLE ONLY savia_core.public_form_submissions
    ADD CONSTRAINT public_form_submissions_pkey PRIMARY KEY (form_id, submission_id);
ALTER TABLE ONLY savia_core.public_forms
    ADD CONSTRAINT public_forms_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.public_forms
    ADD CONSTRAINT public_forms_token_key UNIQUE (token);
ALTER TABLE ONLY savia_core.ramos
    ADD CONSTRAINT ramos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.request_page_runs
    ADD CONSTRAINT request_page_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.savia_request_audit
    ADD CONSTRAINT savia_request_audit_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.server_id_sequences
    ADD CONSTRAINT server_id_sequences_pkey PRIMARY KEY (resource);
ALTER TABLE ONLY savia_core.sub_ramos
    ADD CONSTRAINT sub_ramos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.tenant_branding_assets
    ADD CONSTRAINT tenant_branding_assets_object_key_key UNIQUE (object_key);
ALTER TABLE ONLY savia_core.tenant_branding_assets
    ADD CONSTRAINT tenant_branding_assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.tenant_branding
    ADD CONSTRAINT tenant_branding_pkey PRIMARY KEY (tenant_id);
ALTER TABLE ONLY savia_core.tenant_bundles
    ADD CONSTRAINT tenant_bundles_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE ONLY savia_core.tenant_consolidation_agency_bootstraps
    ADD CONSTRAINT tenant_consolidation_agency_bootstraps_pkey PRIMARY KEY (target_tenant_id);
ALTER TABLE ONLY savia_core.tenant_consolidation_discards
    ADD CONSTRAINT tenant_consolidation_discards_pkey PRIMARY KEY (source_tenant_id, table_name, record_key);
ALTER TABLE ONLY savia_core.tenant_consolidation_sources
    ADD CONSTRAINT tenant_consolidation_sources_pkey PRIMARY KEY (source_tenant_id);
ALTER TABLE ONLY savia_core.tenant_flow_runs
    ADD CONSTRAINT tenant_flow_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.tenant_flow_variables
    ADD CONSTRAINT tenant_flow_variables_pkey PRIMARY KEY (tenant_id, flow_id, key);
ALTER TABLE ONLY savia_core.tenant_flow_versions
    ADD CONSTRAINT tenant_flow_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.tenant_flows
    ADD CONSTRAINT tenant_flows_pkey PRIMARY KEY (tenant_id, flow_id);
ALTER TABLE ONLY savia_core.tenant_folders
    ADD CONSTRAINT tenant_folders_pkey PRIMARY KEY (tenant_id, path);
ALTER TABLE ONLY savia_core.tenant_namespace_migrations
    ADD CONSTRAINT tenant_namespace_migrations_pkey PRIMARY KEY (old_key);
ALTER TABLE ONLY savia_core.tenants
    ADD CONSTRAINT tenants_id_slug_key UNIQUE (id_slug);
ALTER TABLE ONLY savia_core.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.user_appearance_preferences
    ADD CONSTRAINT user_appearance_preferences_pkey PRIMARY KEY (principal_id);
ALTER TABLE ONLY savia_core.user_my_day_widgets
    ADD CONSTRAINT user_my_day_widgets_pkey PRIMARY KEY (principal_id);
ALTER TABLE ONLY savia_core.user_navigation_preferences
    ADD CONSTRAINT user_navigation_preferences_pkey PRIMARY KEY (principal_id);
ALTER TABLE ONLY savia_core.user_provider_credential_audit_events
    ADD CONSTRAINT user_provider_credential_audit_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.user_provider_credentials
    ADD CONSTRAINT user_provider_credentials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.workflow_events
    ADD CONSTRAINT workflow_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY savia_core.workflow_executions
    ADD CONSTRAINT workflow_executions_pkey PRIMARY KEY (workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_executions
    ADD CONSTRAINT workflow_executions_workspace_id_workflow_id_event_key_key UNIQUE (workspace_id, workflow_id, event_key);
ALTER TABLE ONLY savia_core.workflow_jobs
    ADD CONSTRAINT workflow_jobs_pkey PRIMARY KEY (workspace_id, execution_id, node_id);
ALTER TABLE ONLY savia_core.workflow_tasks
    ADD CONSTRAINT workflow_tasks_pkey PRIMARY KEY (workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_tasks
    ADD CONSTRAINT workflow_tasks_workspace_id_execution_id_node_id_key UNIQUE (workspace_id, execution_id, node_id);
ALTER TABLE ONLY savia_core.workflow_versions
    ADD CONSTRAINT workflow_versions_pkey PRIMARY KEY (workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_versions
    ADD CONSTRAINT workflow_versions_workspace_id_workflow_id_revision_key UNIQUE (workspace_id, workflow_id, revision);
ALTER TABLE ONLY savia_core.workflow_webhook_admissions
    ADD CONSTRAINT workflow_webhook_admissions_pkey PRIMARY KEY (endpoint_id, minute);
ALTER TABLE ONLY savia_core.workflow_webhook_attempts
    ADD CONSTRAINT workflow_webhook_attempts_pkey PRIMARY KEY (workspace_id, execution_id, node_id, sequence);
ALTER TABLE ONLY savia_core.workflow_webhook_deliveries
    ADD CONSTRAINT workflow_webhook_deliveries_pkey PRIMARY KEY (workspace_id, execution_id, node_id);
ALTER TABLE ONLY savia_core.workflow_webhook_destination_versions
    ADD CONSTRAINT workflow_webhook_destination_versions_pkey PRIMARY KEY (workspace_id, id, revision);
ALTER TABLE ONLY savia_core.workflow_webhook_destinations
    ADD CONSTRAINT workflow_webhook_destinations_pkey PRIMARY KEY (workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_webhook_endpoints
    ADD CONSTRAINT workflow_webhook_endpoints_id_key UNIQUE (id);
ALTER TABLE ONLY savia_core.workflow_webhook_endpoints
    ADD CONSTRAINT workflow_webhook_endpoints_pkey PRIMARY KEY (workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_webhook_endpoints
    ADD CONSTRAINT workflow_webhook_endpoints_workspace_id_workflow_id_key UNIQUE (workspace_id, workflow_id);
ALTER TABLE ONLY savia_core.workflow_webhook_receipts
    ADD CONSTRAINT workflow_webhook_receipts_pkey PRIMARY KEY (workspace_id, endpoint_id, event_key);
ALTER TABLE ONLY savia_core.workflow_write_context
    ADD CONSTRAINT workflow_write_context_pkey PRIMARY KEY (workspace_id, record_id);
ALTER TABLE ONLY savia_core.workflows
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (workspace_id, id);
CREATE INDEX access_audit_scope ON savia_core.access_audit USING btree (scope, created_at);
CREATE INDEX access_grants_role ON savia_core.access_grants USING btree (scope, role_id);
CREATE INDEX admin_oauth_transactions_expires_at_index ON savia_core.admin_oauth_transactions USING btree (expires_at);
CREATE UNIQUE INDEX agencies_id_slug_unique ON savia_core.agencies USING btree (id_slug);
CREATE UNIQUE INDEX agencies_short_name_unique ON savia_core.agencies USING btree (short_name);
CREATE UNIQUE INDEX agencies_tenant_unique ON savia_core.agencies USING btree (tenant_id);
CREATE INDEX agency_branches_agency_id_index ON savia_core.agency_branches USING btree (agency_id);
CREATE INDEX agency_branches_city_id_index ON savia_core.agency_branches USING btree (city_id);
CREATE UNIQUE INDEX agency_branches_id_slug_unique ON savia_core.agency_branches USING btree (id_slug);
CREATE INDEX agency_contacts_agency_id_index ON savia_core.agency_contacts USING btree (agency_id);
CREATE UNIQUE INDEX agency_contacts_id_slug_unique ON savia_core.agency_contacts USING btree (id_slug);
CREATE INDEX agency_crm_connection_audit_events_agency_created_at_index ON savia_core.tenant_crm_connection_audit_events USING btree (tenant_id, created_at);
CREATE INDEX agency_crm_connection_audit_events_connection_created_at_index ON savia_core.tenant_crm_connection_audit_events USING btree (connection_id, created_at);
CREATE INDEX app_economicactivity_code_a9ea7a57_like ON savia_core.app_economicactivity USING btree (code);
CREATE UNIQUE INDEX app_economicactivity_code_key ON savia_core.app_economicactivity USING btree (code);
CREATE INDEX assistant_active_agencies_agency_index ON savia_core.assistant_active_tenants USING btree (tenant_id);
CREATE INDEX assistant_active_tenants_tenant_index ON savia_core.assistant_active_tenants USING btree (tenant_id);
CREATE UNIQUE INDEX assistant_openrouter_settings_agency_unique ON savia_core.assistant_openrouter_settings USING btree (agency_id) WHERE (scope = 'agency'::text);
CREATE INDEX assistant_pending_actions_principal_status_index ON savia_core.assistant_pending_actions USING btree (principal_id, status, expires_at);
CREATE INDEX assistant_virtual_employee_chunks_lookup ON savia_core.assistant_virtual_employee_chunks USING btree (employee_id, file_id);
CREATE INDEX assistant_virtual_employee_files_employee_index ON savia_core.assistant_virtual_employee_files USING btree (employee_id);
CREATE UNIQUE INDEX assistant_virtual_employees_agency_handle ON savia_core.assistant_virtual_employees USING btree (agency_id, handle) WHERE (agency_id IS NOT NULL);
CREATE INDEX assistant_virtual_employees_agency_index ON savia_core.assistant_virtual_employees USING btree (agency_id);
CREATE UNIQUE INDEX assistant_virtual_employees_global_handle ON savia_core.assistant_virtual_employees USING btree (handle) WHERE (agency_id IS NULL);
CREATE INDEX attachment_uploads_agency_status_index ON savia_core.attachment_uploads USING btree (agency_id, status);
CREATE UNIQUE INDEX attachment_uploads_object_key_unique ON savia_core.attachment_uploads USING btree (object_key);
CREATE INDEX attachment_uploads_target_index ON savia_core.attachment_uploads USING btree (domain, collection, aggregate_id);
CREATE INDEX auto_light_quote_offers_request_created_at_index ON savia_core.auto_light_quote_offers USING btree (quote_request_id, created_at);
CREATE INDEX auto_light_quote_requests_agency_created_at_index ON savia_core.auto_light_quote_requests USING btree (agency_id, created_at);
CREATE INDEX business_commercialunit_agency_id_3f578aee ON savia_core.business_commercialunit USING btree (agency_id);
CREATE INDEX business_commercialunit_id_slug_93b24ac2_like ON savia_core.business_commercialunit USING btree (id_slug);
CREATE UNIQUE INDEX business_commercialunit_id_slug_key ON savia_core.business_commercialunit USING btree (id_slug);
CREATE UNIQUE INDEX categories_id_slug_unique ON savia_core.categories USING btree (id_slug);
CREATE INDEX cities_department_id_index ON savia_core.cities USING btree (department_id);
CREATE UNIQUE INDEX cities_external_id_unique ON savia_core.cities USING btree (external_id);
CREATE UNIQUE INDEX countries_code_unique ON savia_core.countries USING btree (code);
CREATE UNIQUE INDEX countries_name_unique ON savia_core.countries USING btree (name);
CREATE INDEX crm_sync_changes_scope ON savia_core.crm_sync_changes USING btree (tenant_id, object_name, sequence);
CREATE INDEX crm_sync_jobs_due ON savia_core.crm_sync_jobs USING btree (status, next_attempt_at);
CREATE INDEX customer_address_city_id_121281ad ON savia_core.customer_address USING btree (city_id);
CREATE INDEX customer_address_coordinates_0b250f3d_id ON savia_core.customer_address USING btree (coordinates);
CREATE INDEX customer_client_external_id_ff2ecb68 ON savia_core.customer_client USING btree (external_id);
CREATE INDEX customer_client_external_id_ff2ecb68_like ON savia_core.customer_client USING btree (external_id);
CREATE INDEX customer_client_id_slug_51651e62_like ON savia_core.customer_client USING btree (id_slug);
CREATE UNIQUE INDEX customer_client_id_slug_key ON savia_core.customer_client USING btree (id_slug);
CREATE INDEX customer_client_migration_slug_87cd0ef0 ON savia_core.customer_client USING btree (migration_slug);
CREATE INDEX customer_client_migration_slug_87cd0ef0_like ON savia_core.customer_client USING btree (migration_slug);
CREATE INDEX customer_clientagency_agency_id_2219f9d3 ON savia_core.customer_clientagency USING btree (agency_id);
CREATE UNIQUE INDEX customer_clientagency_client_id_agency_id_8d00008e_uniq ON savia_core.customer_clientagency USING btree (client_id, agency_id);
CREATE INDEX customer_clientagency_client_id_f7514a49 ON savia_core.customer_clientagency USING btree (client_id);
CREATE INDEX customer_clientagency_commercial_unit_id_c62e178e ON savia_core.customer_clientagency USING btree (commercial_unit_id);
CREATE INDEX customer_clientagency_created_by_slug_fc0af2df ON savia_core.customer_clientagency USING btree (created_by_slug);
CREATE INDEX customer_clientagency_created_by_slug_fc0af2df_like ON savia_core.customer_clientagency USING btree (created_by_slug);
CREATE INDEX customer_clientagency_group_id_45d26c9d ON savia_core.customer_clientagency USING btree (group_id);
CREATE INDEX customer_clientagency_id_slug_44ceaef1_like ON savia_core.customer_clientagency USING btree (id_slug);
CREATE UNIQUE INDEX customer_clientagency_id_slug_key ON savia_core.customer_clientagency USING btree (id_slug);
CREATE INDEX customer_crm_sync_records_customer_provider_index ON savia_core.customer_crm_sync_records USING btree (customer_profile_id, provider);
CREATE INDEX customer_group_agency_id_3b3c328d ON savia_core.customer_group USING btree (agency_id);
CREATE INDEX customer_group_id_slug_07cbc3f2_like ON savia_core.customer_group USING btree (id_slug);
CREATE UNIQUE INDEX customer_group_id_slug_key ON savia_core.customer_group USING btree (id_slug);
CREATE INDEX customer_legalperson_address_id_93d0acf3 ON savia_core.customer_legalperson USING btree (address_id);
CREATE INDEX customer_legalperson_business_activity_id_fbcde3c5 ON savia_core.customer_legalperson USING btree (business_activity_id);
CREATE INDEX customer_legalperson_client_agency_id_3baf8ef1 ON savia_core.customer_legalperson USING btree (client_id);
CREATE INDEX customer_legalperson_id_slug_7402ef0d_like ON savia_core.customer_legalperson USING btree (id_slug);
CREATE UNIQUE INDEX customer_legalperson_id_slug_key ON savia_core.customer_legalperson USING btree (id_slug);
CREATE INDEX customer_legalperson_lr_id_type_df272121 ON savia_core.customer_legalperson USING btree (lr_id_type);
CREATE INDEX customer_legalperson_lr_id_type_df272121_like ON savia_core.customer_legalperson USING btree (lr_id_type);
CREATE INDEX customer_legalpersoncontact_id_slug_4fbb0989_like ON savia_core.customer_legalpersoncontact USING btree (id_slug);
CREATE UNIQUE INDEX customer_legalpersoncontact_id_slug_key ON savia_core.customer_legalpersoncontact USING btree (id_slug);
CREATE INDEX customer_legalpersoncontact_legal_person_id_af37b447 ON savia_core.customer_legalpersoncontact USING btree (legal_person_id);
CREATE INDEX customer_naturalperson_client_agency_id_d669e098 ON savia_core.customer_naturalperson USING btree (client_id);
CREATE INDEX customer_naturalperson_genre_5fb8d699 ON savia_core.customer_naturalperson USING btree (genre);
CREATE INDEX customer_naturalperson_genre_5fb8d699_like ON savia_core.customer_naturalperson USING btree (genre);
CREATE INDEX customer_naturalperson_home_address_id_94875213 ON savia_core.customer_naturalperson USING btree (home_address_id);
CREATE INDEX customer_naturalperson_id_slug_745981bd_like ON savia_core.customer_naturalperson USING btree (id_slug);
CREATE UNIQUE INDEX customer_naturalperson_id_slug_key ON savia_core.customer_naturalperson USING btree (id_slug);
CREATE INDEX customer_naturalperson_id_type_bc04fc36 ON savia_core.customer_naturalperson USING btree (id_type);
CREATE INDEX customer_naturalperson_id_type_bc04fc36_like ON savia_core.customer_naturalperson USING btree (id_type);
CREATE INDEX customer_naturalperson_marital_status_0279a05c ON savia_core.customer_naturalperson USING btree (marital_status);
CREATE INDEX customer_naturalperson_marital_status_0279a05c_like ON savia_core.customer_naturalperson USING btree (marital_status);
CREATE INDEX customer_naturalperson_work_address_id_191ca03d ON savia_core.customer_naturalperson USING btree (work_address_id);
CREATE INDEX departments_country_id_index ON savia_core.departments USING btree (country_id);
CREATE UNIQUE INDEX departments_external_id_unique ON savia_core.departments USING btree (external_id);
CREATE INDEX document_ownership_agency_index ON savia_core.document_ownership USING btree (agency_id, domain, collection);
CREATE INDEX extension_action_runs_tenant_updated_index ON savia_core.extension_action_runs USING btree (tenant_id, updated_at DESC);
CREATE INDEX extension_connection_audit_events_tenant_created_index ON savia_core.extension_connection_audit_events USING btree (tenant_id, created_at DESC);
CREATE INDEX extension_connections_tenant_updated_index ON savia_core.extension_connections USING btree (tenant_id, updated_at DESC);
CREATE INDEX extension_settings_tenant_updated_index ON savia_core.extension_settings USING btree (tenant_id, updated_at DESC);
CREATE INDEX identity_tenant_membership_tenant_index ON savia_core.identity_tenant_membership USING btree (tenant_id);
CREATE INDEX idx_plugin_store_artifacts_tenant ON savia_core.plugin_store_artifacts USING btree (tenant_id, id);
CREATE INDEX insurer_companies_collection_reconciliation_type_index ON savia_core.insurer_companies USING btree (collection_reconciliation_type);
CREATE UNIQUE INDEX insurer_companies_id_slug_unique ON savia_core.insurer_companies USING btree (id_slug);
CREATE INDEX insurer_companies_reconciliation_type_index ON savia_core.insurer_companies USING btree (reconciliation_type);
CREATE INDEX notification_audit_scope ON savia_core.notification_admin_audit USING btree (workspace_id, created_at, id);
CREATE INDEX notification_events_due ON savia_core.notification_events USING btree (status, next_retry, lease_until, created_at, id);
CREATE INDEX notification_followers ON savia_core.notification_subscriptions USING btree (workspace_id, collection, principal_id, created_at);
CREATE INDEX notification_inbox ON savia_core.notification_deliveries USING btree (recipient_id, scope_kind, scope_id, created_at DESC, id DESC);
CREATE INDEX notification_retries_due ON savia_core.notification_recipient_retries USING btree (status, next_retry, event_id);
CREATE INDEX notification_unread ON savia_core.notification_deliveries USING btree (recipient_id, scope_kind, scope_id, read_at, archived_at);
CREATE INDEX personal_integration_audit_events_connection_created_at_index ON savia_core.personal_integration_audit_events USING btree (connection_id, created_at);
CREATE INDEX personal_integration_audit_events_principal_created_at_index ON savia_core.personal_integration_audit_events USING btree (principal_id, created_at);
CREATE UNIQUE INDEX personal_integration_connections_active_unique ON savia_core.personal_integration_connections USING btree (principal_id, provider) WHERE (disconnected_at IS NULL);
CREATE INDEX personal_integration_connections_principal_provider_index ON savia_core.personal_integration_connections USING btree (principal_id, provider);
CREATE INDEX public_form_submissions_ip_day ON savia_core.public_form_submissions USING btree (ip_hash, day);
CREATE INDEX public_form_submissions_link_day ON savia_core.public_form_submissions USING btree (form_id, day);
CREATE INDEX public_form_submissions_tenant_day ON savia_core.public_form_submissions USING btree (tenant_id, day);
CREATE INDEX public_forms_management ON savia_core.public_forms USING btree (tenant_id, object_name, created_at);
CREATE UNIQUE INDEX ramos_id_slug_unique ON savia_core.ramos USING btree (id_slug);
CREATE INDEX ramos_sub_ramo_id_index ON savia_core.ramos USING btree (sub_ramo_id);
CREATE INDEX request_page_runs_owner_page ON savia_core.request_page_runs USING btree (principal_id, tenant_id, page_name, created_at);
CREATE INDEX savia_request_audit_scope_idx ON savia_core.savia_request_audit USING btree (tenant_id, created_at DESC, id DESC);
CREATE INDEX studio_file_drafts_expiry ON savia_core.studio_file_drafts USING btree (tenant_id, expires_at);
CREATE INDEX studio_files_record ON savia_core.studio_files USING btree (tenant_id, record_id, created_at);
CREATE INDEX studio_files_record_field ON savia_core.studio_files USING btree (tenant_id, object_name, record_id, field_name, created_at);
CREATE INDEX studio_integration_runs_history ON savia_core.studio_integration_runs USING btree (tenant_id, integration_id, created_at);
CREATE UNIQUE INDEX studio_integration_runs_idempotency ON savia_core.studio_integration_runs USING btree (tenant_id, integration_id, operation_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX studio_integrations_owner_index ON savia_core.studio_integrations USING btree (tenant_id, owner_principal_id);
CREATE INDEX studio_notes_record ON savia_core.studio_notes USING btree (tenant_id, record_id, created_at);
CREATE INDEX studio_record_history_expiry ON savia_core.studio_record_history USING btree (expires_at);
CREATE INDEX studio_record_links_incoming ON savia_core.studio_record_links USING btree (tenant_id, relation_id, target_id, source_id);
CREATE INDEX studio_records_active ON savia_core.studio_records USING btree (tenant_id, object_name, deleted_at, updated_at);
CREATE INDEX studio_records_active_created_order ON savia_core.studio_records USING btree (tenant_id, object_name, deleted_at, created_at DESC, id);
CREATE INDEX studio_records_active_updated_order ON savia_core.studio_records USING btree (tenant_id, object_name, deleted_at, updated_at DESC, id);
CREATE INDEX studio_records_object ON savia_core.studio_records USING btree (tenant_id, object_name, updated_at);
CREATE INDEX studio_tasks_due ON savia_core.studio_tasks USING btree (tenant_id, status, due_at);
CREATE INDEX studio_unique_record ON savia_core.studio_unique_values USING btree (tenant_id, record_id);
CREATE INDEX sub_ramos_category_id_index ON savia_core.sub_ramos USING btree (category_id);
CREATE UNIQUE INDEX sub_ramos_id_slug_unique ON savia_core.sub_ramos USING btree (id_slug);
CREATE INDEX tenant_branding_assets_tenant ON savia_core.tenant_branding_assets USING btree (tenant_id);
CREATE INDEX tenant_crm_connection_audit_events_connection_created_at_index ON savia_core.tenant_crm_connection_audit_events USING btree (connection_id, created_at);
CREATE INDEX tenant_crm_connection_audit_events_tenant_created_at_index ON savia_core.tenant_crm_connection_audit_events USING btree (tenant_id, created_at);
CREATE UNIQUE INDEX tenant_crm_connections_active_unique ON savia_core.tenant_crm_connections USING btree (created_by_principal_id, tenant_id, provider) WHERE (disconnected_at IS NULL);
CREATE INDEX tenant_crm_connections_owner_index ON savia_core.tenant_crm_connections USING btree (created_by_principal_id, tenant_id, provider);
CREATE INDEX tenant_crm_connections_tenant_provider_index ON savia_core.tenant_crm_connections USING btree (tenant_id, provider);
CREATE INDEX tenant_flow_runs_scope_idx ON savia_core.tenant_flow_runs USING btree (tenant_id, flow_id, created_at);
CREATE INDEX tenant_flow_versions_scope_idx ON savia_core.tenant_flow_versions USING btree (tenant_id, flow_id, created_at);
CREATE UNIQUE INDEX unique_agency_commercial_unit ON savia_core.business_commercialunit USING btree (agency_id, name);
CREATE UNIQUE INDEX unique_id_number ON savia_core.customer_client USING btree (id_number) WHERE (NOT (upper(id_number) = upper(''::text)));
CREATE INDEX user_provider_credential_audit_events_owner_created_at_index ON savia_core.user_provider_credential_audit_events USING btree (owner_principal_id, created_at);
CREATE INDEX user_provider_credentials_owner_index ON savia_core.user_provider_credentials USING btree (owner_principal_id);
CREATE UNIQUE INDEX user_provider_credentials_owner_provider_unique ON savia_core.user_provider_credentials USING btree (owner_principal_id, provider);
CREATE INDEX workflow_executions_due ON savia_core.workflow_executions USING btree (status, wake_at, lease_until);
CREATE INDEX workflow_executions_history ON savia_core.workflow_executions USING btree (workspace_id, workflow_id, created_at);
CREATE INDEX workflow_tasks_inbox ON savia_core.workflow_tasks USING btree (workspace_id, assignee, status);
CREATE TRIGGER access_global_role_added AFTER INSERT ON savia_core.identity_global_role FOR EACH ROW EXECUTE FUNCTION savia_core.access_global_role_added_fn();
CREATE TRIGGER access_global_role_removed AFTER DELETE ON savia_core.identity_global_role FOR EACH ROW EXECUTE FUNCTION savia_core.access_global_role_removed_fn();
CREATE TRIGGER access_membership_changed AFTER UPDATE OF tenant_id, role, is_active ON savia_core.identity_tenant_membership FOR EACH ROW EXECUTE FUNCTION savia_core.access_membership_changed_fn();
CREATE TRIGGER access_membership_created AFTER INSERT ON savia_core.identity_tenant_membership FOR EACH ROW EXECUTE FUNCTION savia_core.access_membership_created_fn();
CREATE TRIGGER access_membership_removed AFTER DELETE ON savia_core.identity_tenant_membership FOR EACH ROW EXECUTE FUNCTION savia_core.access_membership_removed_fn();
CREATE TRIGGER access_object_changed AFTER UPDATE OF config ON savia_core.studio_objects FOR EACH ROW EXECUTE FUNCTION savia_core.access_object_changed_fn();
CREATE TRIGGER access_object_removed AFTER DELETE ON savia_core.studio_objects FOR EACH ROW EXECUTE FUNCTION savia_core.access_object_removed_fn();
CREATE TRIGGER access_principal_changed AFTER UPDATE OF is_active ON savia_core.identity_principal FOR EACH ROW EXECUTE FUNCTION savia_core.access_principal_changed_fn();
CREATE TRIGGER access_tenant_created AFTER INSERT ON savia_core.tenants FOR EACH ROW EXECUTE FUNCTION savia_core.access_tenant_created_fn();
CREATE TRIGGER access_tenant_removed AFTER DELETE ON savia_core.tenants FOR EACH ROW EXECUTE FUNCTION savia_core.access_tenant_removed_fn();
CREATE TRIGGER access_tenant_state_changed AFTER UPDATE OF is_active, kind ON savia_core.tenants FOR EACH ROW EXECUTE FUNCTION savia_core.access_tenant_state_changed_fn();
CREATE TRIGGER agency_crm_connection_audit_events_insert INSTEAD OF INSERT ON savia_core.agency_crm_connection_audit_events FOR EACH ROW EXECUTE FUNCTION savia_core.agency_crm_connection_audit_events_insert_fn();
CREATE TRIGGER agency_crm_connections_delete INSTEAD OF DELETE ON savia_core.agency_crm_connections FOR EACH ROW EXECUTE FUNCTION savia_core.agency_crm_connections_delete_fn();
CREATE TRIGGER agency_crm_connections_insert INSTEAD OF INSERT ON savia_core.agency_crm_connections FOR EACH ROW EXECUTE FUNCTION savia_core.agency_crm_connections_insert_fn();
CREATE TRIGGER agency_crm_connections_update INSTEAD OF UPDATE ON savia_core.agency_crm_connections FOR EACH ROW EXECUTE FUNCTION savia_core.agency_crm_connections_update_fn();
CREATE TRIGGER agency_tenant_create AFTER INSERT ON savia_core.agencies FOR EACH ROW EXECUTE FUNCTION savia_core.agency_tenant_create_fn();
CREATE TRIGGER agency_tenant_identity_insert BEFORE INSERT ON savia_core.agencies FOR EACH ROW EXECUTE FUNCTION savia_core.agency_tenant_identity_insert_fn();
CREATE TRIGGER agency_tenant_identity_update BEFORE UPDATE OF id, tenant_id ON savia_core.agencies FOR EACH ROW EXECUTE FUNCTION savia_core.agency_tenant_identity_update_fn();
CREATE TRIGGER agency_tenant_update AFTER UPDATE OF id_slug, name, is_active, updated_at ON savia_core.agencies FOR EACH ROW EXECUTE FUNCTION savia_core.agency_tenant_update_fn();
CREATE TRIGGER assistant_active_agencies_delete INSTEAD OF DELETE ON savia_core.assistant_active_agencies FOR EACH ROW EXECUTE FUNCTION savia_core.assistant_active_agencies_delete_fn();
CREATE TRIGGER assistant_active_agencies_insert INSTEAD OF INSERT ON savia_core.assistant_active_agencies FOR EACH ROW EXECUTE FUNCTION savia_core.assistant_active_agencies_insert_fn();
CREATE TRIGGER crm_sync_customer_address_delete AFTER DELETE ON savia_core.customer_address FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_address_delete_fn();
CREATE TRIGGER crm_sync_customer_address_insert AFTER INSERT ON savia_core.customer_address FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_address_insert_fn();
CREATE TRIGGER crm_sync_customer_address_update AFTER UPDATE ON savia_core.customer_address FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_address_update_fn();
CREATE TRIGGER crm_sync_customer_clientagency_insert AFTER INSERT ON savia_core.customer_clientagency FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_clientagency_insert_fn();
CREATE TRIGGER crm_sync_customer_clientagency_update AFTER UPDATE ON savia_core.customer_clientagency FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_clientagency_update_fn();
CREATE TRIGGER crm_sync_customer_deleted AFTER DELETE ON savia_core.customer_clientagency FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_deleted_fn();
CREATE TRIGGER crm_sync_customer_legalperson_insert AFTER INSERT ON savia_core.customer_legalperson FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_legalperson_insert_fn();
CREATE TRIGGER crm_sync_customer_legalperson_update AFTER UPDATE ON savia_core.customer_legalperson FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_legalperson_update_fn();
CREATE TRIGGER crm_sync_customer_legalpersoncontact_delete AFTER DELETE ON savia_core.customer_legalpersoncontact FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_legalpersoncontact_delete_fn();
CREATE TRIGGER crm_sync_customer_legalpersoncontact_insert AFTER INSERT ON savia_core.customer_legalpersoncontact FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_legalpersoncontact_insert_fn();
CREATE TRIGGER crm_sync_customer_legalpersoncontact_update AFTER UPDATE ON savia_core.customer_legalpersoncontact FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_legalpersoncontact_update_fn();
CREATE TRIGGER crm_sync_customer_naturalperson_insert AFTER INSERT ON savia_core.customer_naturalperson FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_naturalperson_insert_fn();
CREATE TRIGGER crm_sync_customer_naturalperson_update AFTER UPDATE ON savia_core.customer_naturalperson FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_customer_naturalperson_update_fn();
CREATE TRIGGER crm_sync_delete AFTER DELETE ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_delete_fn();
CREATE TRIGGER crm_sync_insert AFTER INSERT ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_insert_fn();
CREATE TRIGGER crm_sync_update AFTER UPDATE ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.crm_sync_update_fn();
CREATE TRIGGER identity_principal_active_email_guard BEFORE INSERT OR UPDATE ON savia_core.identity_principal FOR EACH ROW EXECUTE FUNCTION savia_core.identity_principal_active_email_guard_fn();
CREATE TRIGGER notification_event_fanout AFTER INSERT ON savia_core.notification_events FOR EACH ROW EXECUTE FUNCTION savia_core.notification_event_fanout_fn();
CREATE TRIGGER notification_record_insert AFTER INSERT ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.notification_record_event_fn();
CREATE TRIGGER notification_record_purge AFTER DELETE ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.notification_record_event_fn();
CREATE TRIGGER notification_record_update AFTER UPDATE ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.notification_record_event_fn();
CREATE TRIGGER studio_history_delete AFTER DELETE ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.crm_history_delete_fn();
CREATE TRIGGER studio_history_insert AFTER INSERT ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.crm_history_write_fn();
CREATE TRIGGER studio_history_update AFTER UPDATE ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.crm_history_write_fn();
CREATE TRIGGER studio_record_links_cardinality BEFORE INSERT ON savia_core.studio_record_links FOR EACH ROW EXECUTE FUNCTION savia_core.crm_record_links_cardinality_fn();
CREATE TRIGGER studio_record_links_storage BEFORE INSERT ON savia_core.studio_record_links FOR EACH ROW EXECUTE FUNCTION savia_core.crm_record_links_storage_fn();
CREATE TRIGGER studio_relation_definition_update BEFORE UPDATE ON savia_core.studio_collection_relations FOR EACH ROW EXECUTE FUNCTION savia_core.crm_relation_definition_update_fn();
CREATE TRIGGER tenant_agency_update AFTER UPDATE OF id_slug, name, is_active, updated_at ON savia_core.tenants FOR EACH ROW EXECUTE FUNCTION savia_core.tenant_agency_update_fn();
CREATE TRIGGER workflow_event_dispatch AFTER INSERT ON savia_core.workflow_events FOR EACH ROW EXECUTE FUNCTION savia_core.workflow_event_dispatch_fn();
CREATE TRIGGER workflow_record_created AFTER INSERT ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.workflow_record_write_fn();
CREATE TRIGGER workflow_record_deleted AFTER UPDATE OF deleted_at ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.workflow_record_delete_fn();
CREATE TRIGGER workflow_record_hard_deleted AFTER DELETE ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.workflow_record_delete_fn();
CREATE TRIGGER workflow_record_updated AFTER UPDATE OF data ON savia_core.studio_records FOR EACH ROW EXECUTE FUNCTION savia_core.workflow_record_write_fn();
ALTER TABLE ONLY savia_core.access_assignments
    ADD CONSTRAINT access_assignments_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.access_assignments
    ADD CONSTRAINT access_assignments_scope_role_id_fkey FOREIGN KEY (scope, role_id) REFERENCES savia_core.access_roles(scope, id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.access_grants
    ADD CONSTRAINT access_grants_scope_role_id_fkey FOREIGN KEY (scope, role_id) REFERENCES savia_core.access_roles(scope, id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.access_roles
    ADD CONSTRAINT access_roles_scope_fkey FOREIGN KEY (scope) REFERENCES savia_core.access_revisions(scope);
ALTER TABLE ONLY savia_core.agencies
    ADD CONSTRAINT agencies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES savia_core.tenants(id);
ALTER TABLE ONLY savia_core.agency_branches
    ADD CONSTRAINT agency_branches_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES savia_core.agencies(id);
ALTER TABLE ONLY savia_core.agency_branches
    ADD CONSTRAINT agency_branches_city_id_fkey FOREIGN KEY (city_id) REFERENCES savia_core.cities(id);
ALTER TABLE ONLY savia_core.agency_contacts
    ADD CONSTRAINT agency_contacts_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES savia_core.agencies(id);
ALTER TABLE ONLY savia_core.tenant_crm_connection_audit_events
    ADD CONSTRAINT agency_crm_connection_audit_events_agency_id_fkey FOREIGN KEY (tenant_id) REFERENCES savia_core.tenants(id);
ALTER TABLE ONLY savia_core.tenant_crm_connection_audit_events
    ADD CONSTRAINT agency_crm_connection_audit_events_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES savia_core.tenant_crm_connections(id);
ALTER TABLE ONLY savia_core.tenant_crm_connection_audit_events
    ADD CONSTRAINT agency_crm_connection_audit_events_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id);
ALTER TABLE ONLY savia_core.tenant_crm_connections
    ADD CONSTRAINT agency_crm_connections_agency_id_fkey FOREIGN KEY (tenant_id) REFERENCES savia_core.tenants(id);
ALTER TABLE ONLY savia_core.tenant_crm_connections
    ADD CONSTRAINT agency_crm_connections_created_by_principal_id_fkey FOREIGN KEY (created_by_principal_id) REFERENCES savia_core.identity_principal(id);
ALTER TABLE ONLY savia_core.assistant_active_tenants
    ADD CONSTRAINT assistant_active_agencies_agency_id_fkey FOREIGN KEY (tenant_id) REFERENCES savia_core.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.assistant_active_tenants
    ADD CONSTRAINT assistant_active_agencies_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.assistant_openrouter_settings
    ADD CONSTRAINT assistant_openrouter_settings_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES savia_core.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.assistant_virtual_employee_chunks
    ADD CONSTRAINT assistant_virtual_employee_chunks_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES savia_core.assistant_virtual_employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.assistant_virtual_employee_chunks
    ADD CONSTRAINT assistant_virtual_employee_chunks_file_id_fkey FOREIGN KEY (file_id) REFERENCES savia_core.assistant_virtual_employee_files(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.assistant_virtual_employee_files
    ADD CONSTRAINT assistant_virtual_employee_files_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES savia_core.assistant_virtual_employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.assistant_virtual_employees
    ADD CONSTRAINT assistant_virtual_employees_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES savia_core.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.attachment_uploads
    ADD CONSTRAINT attachment_uploads_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES savia_core.agencies(id);
ALTER TABLE ONLY savia_core.auto_light_quote_offers
    ADD CONSTRAINT auto_light_quote_offers_credential_owner_principal_id_fkey FOREIGN KEY (credential_owner_principal_id) REFERENCES savia_core.identity_principal(id);
ALTER TABLE ONLY savia_core.auto_light_quote_offers
    ADD CONSTRAINT auto_light_quote_offers_quote_request_id_fkey FOREIGN KEY (quote_request_id) REFERENCES savia_core.auto_light_quote_requests(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.auto_light_quote_requests
    ADD CONSTRAINT auto_light_quote_requests_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES savia_core.agencies(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.auto_light_quote_requests
    ADD CONSTRAINT auto_light_quote_requests_created_by_principal_id_fkey FOREIGN KEY (created_by_principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.business_commercialunit
    ADD CONSTRAINT business_commercialu_agency_id_3f578aee_fk_business_ FOREIGN KEY (agency_id) REFERENCES savia_core.agencies(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.cities
    ADD CONSTRAINT cities_department_id_fkey FOREIGN KEY (department_id) REFERENCES savia_core.departments(id);
ALTER TABLE ONLY savia_core.studio_business_links
    ADD CONSTRAINT crm_business_links_tenant_id_record_id_fkey FOREIGN KEY (tenant_id, record_id) REFERENCES savia_core.studio_records(tenant_id, id);
ALTER TABLE ONLY savia_core.crm_collection_bindings
    ADD CONSTRAINT crm_collection_bindings_tenant_id_object_name_fkey FOREIGN KEY (tenant_id, object_name) REFERENCES savia_core.studio_objects(tenant_id, name);
ALTER TABLE ONLY savia_core.studio_collection_relations
    ADD CONSTRAINT crm_collection_relations_tenant_id_source_object_fkey FOREIGN KEY (tenant_id, source_object) REFERENCES savia_core.studio_objects(tenant_id, name) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.studio_collection_relations
    ADD CONSTRAINT crm_collection_relations_tenant_id_target_object_fkey FOREIGN KEY (tenant_id, target_object) REFERENCES savia_core.studio_objects(tenant_id, name) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.studio_file_revisions
    ADD CONSTRAINT crm_file_revisions_file_id_fkey FOREIGN KEY (file_id) REFERENCES savia_core.studio_files(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.studio_files
    ADD CONSTRAINT crm_files_tenant_id_record_id_fkey FOREIGN KEY (tenant_id, record_id) REFERENCES savia_core.studio_records(tenant_id, id);
ALTER TABLE ONLY savia_core.studio_notes
    ADD CONSTRAINT crm_notes_tenant_id_record_id_fkey FOREIGN KEY (tenant_id, record_id) REFERENCES savia_core.studio_records(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.studio_record_links
    ADD CONSTRAINT crm_record_links_tenant_id_relation_id_fkey FOREIGN KEY (tenant_id, relation_id) REFERENCES savia_core.studio_collection_relations(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.studio_records
    ADD CONSTRAINT crm_records_tenant_id_object_name_fkey FOREIGN KEY (tenant_id, object_name) REFERENCES savia_core.studio_objects(tenant_id, name);
ALTER TABLE ONLY savia_core.studio_solution_objects
    ADD CONSTRAINT crm_solution_objects_tenant_id_solution_id_fkey FOREIGN KEY (tenant_id, solution_id) REFERENCES savia_core.studio_solution_installations(tenant_id, id);
ALTER TABLE ONLY savia_core.crm_sync_jobs
    ADD CONSTRAINT crm_sync_jobs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES savia_core.crm_sync_rules(id);
ALTER TABLE ONLY savia_core.crm_sync_mappings
    ADD CONSTRAINT crm_sync_mappings_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES savia_core.crm_sync_rules(id);
ALTER TABLE ONLY savia_core.crm_sync_rules
    ADD CONSTRAINT crm_sync_rules_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES savia_core.tenant_crm_connections(id);
ALTER TABLE ONLY savia_core.crm_sync_rules
    ADD CONSTRAINT crm_sync_rules_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id);
ALTER TABLE ONLY savia_core.crm_sync_rules
    ADD CONSTRAINT crm_sync_rules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES savia_core.tenants(id);
ALTER TABLE ONLY savia_core.studio_tasks
    ADD CONSTRAINT crm_tasks_tenant_id_record_id_fkey FOREIGN KEY (tenant_id, record_id) REFERENCES savia_core.studio_records(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.customer_address
    ADD CONSTRAINT customer_address_city_id_121281ad_fk_app_city_id FOREIGN KEY (city_id) REFERENCES savia_core.cities(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_clientagency
    ADD CONSTRAINT customer_clientagenc_commercial_unit_id_c62e178e_fk_business_ FOREIGN KEY (commercial_unit_id) REFERENCES savia_core.business_commercialunit(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_clientagency
    ADD CONSTRAINT customer_clientagency_agency_id_2219f9d3_fk_business_agency_id FOREIGN KEY (agency_id) REFERENCES savia_core.agencies(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_clientagency
    ADD CONSTRAINT customer_clientagency_client_id_f7514a49_fk_customer_client_id FOREIGN KEY (client_id) REFERENCES savia_core.customer_client(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_clientagency
    ADD CONSTRAINT customer_clientagency_group_id_45d26c9d_fk_customer_group_id FOREIGN KEY (group_id) REFERENCES savia_core.customer_group(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_crm_sync_records
    ADD CONSTRAINT customer_crm_sync_records_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES savia_core.agencies(id);
ALTER TABLE ONLY savia_core.customer_crm_sync_records
    ADD CONSTRAINT customer_crm_sync_records_customer_profile_id_fkey FOREIGN KEY (customer_profile_id) REFERENCES savia_core.customer_clientagency(id);
ALTER TABLE ONLY savia_core.customer_crm_sync_records
    ADD CONSTRAINT customer_crm_sync_records_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id);
ALTER TABLE ONLY savia_core.customer_group
    ADD CONSTRAINT customer_group_agency_id_3b3c328d_fk_business_agency_id FOREIGN KEY (agency_id) REFERENCES savia_core.agencies(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_legalperson
    ADD CONSTRAINT customer_legalperson_address_id_93d0acf3_fk_customer_address_id FOREIGN KEY (address_id) REFERENCES savia_core.customer_address(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_legalperson
    ADD CONSTRAINT customer_legalperson_business_activity_id_fbcde3c5_fk_app_econo FOREIGN KEY (business_activity_id) REFERENCES savia_core.app_economicactivity(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_legalperson
    ADD CONSTRAINT customer_legalperson_client_id_4bf9637a_fk_customer_ FOREIGN KEY (client_id) REFERENCES savia_core.customer_clientagency(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_legalpersoncontact
    ADD CONSTRAINT customer_legalperson_legal_person_id_af37b447_fk_customer_ FOREIGN KEY (legal_person_id) REFERENCES savia_core.customer_legalperson(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_naturalperson
    ADD CONSTRAINT customer_naturalpers_client_id_64a2c072_fk_customer_ FOREIGN KEY (client_id) REFERENCES savia_core.customer_clientagency(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_naturalperson
    ADD CONSTRAINT customer_naturalpers_home_address_id_94875213_fk_customer_ FOREIGN KEY (home_address_id) REFERENCES savia_core.customer_address(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.customer_naturalperson
    ADD CONSTRAINT customer_naturalpers_work_address_id_191ca03d_fk_customer_ FOREIGN KEY (work_address_id) REFERENCES savia_core.customer_address(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY savia_core.departments
    ADD CONSTRAINT departments_country_id_fkey FOREIGN KEY (country_id) REFERENCES savia_core.countries(id);
ALTER TABLE ONLY savia_core.document_ownership
    ADD CONSTRAINT document_ownership_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES savia_core.agencies(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.identity_global_role
    ADD CONSTRAINT identity_global_role_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.identity_tenant_membership
    ADD CONSTRAINT identity_tenant_membership_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.identity_tenant_membership
    ADD CONSTRAINT identity_tenant_membership_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES savia_core.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.legacy_import_streams
    ADD CONSTRAINT legacy_import_streams_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES savia_core.legacy_import_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.managed_customer_extensions
    ADD CONSTRAINT managed_customer_extensions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES savia_core.customer_clientagency(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.notification_deliveries
    ADD CONSTRAINT notification_deliveries_event_id_fkey FOREIGN KEY (event_id) REFERENCES savia_core.notification_events(id);
ALTER TABLE ONLY savia_core.notification_recipient_retries
    ADD CONSTRAINT notification_recipient_retries_event_id_fkey FOREIGN KEY (event_id) REFERENCES savia_core.notification_events(id);
ALTER TABLE ONLY savia_core.personal_integration_audit_events
    ADD CONSTRAINT personal_integration_audit_events_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES savia_core.personal_integration_connections(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.personal_integration_audit_events
    ADD CONSTRAINT personal_integration_audit_events_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.personal_integration_connections
    ADD CONSTRAINT personal_integration_connections_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.public_form_short_links
    ADD CONSTRAINT public_form_short_links_form_id_fkey FOREIGN KEY (form_id) REFERENCES savia_core.public_forms(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.public_form_submissions
    ADD CONSTRAINT public_form_submissions_form_id_fkey FOREIGN KEY (form_id) REFERENCES savia_core.public_forms(id);
ALTER TABLE ONLY savia_core.ramos
    ADD CONSTRAINT ramos_sub_ramo_id_fkey FOREIGN KEY (sub_ramo_id) REFERENCES savia_core.sub_ramos(id);
ALTER TABLE ONLY savia_core.sub_ramos
    ADD CONSTRAINT sub_ramos_category_id_fkey FOREIGN KEY (category_id) REFERENCES savia_core.categories(id);
ALTER TABLE ONLY savia_core.tenant_branding_assets
    ADD CONSTRAINT tenant_branding_assets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES savia_core.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.tenant_branding
    ADD CONSTRAINT tenant_branding_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES savia_core.tenants(id) ON DELETE CASCADE;
ALTER TABLE ONLY savia_core.user_appearance_preferences
    ADD CONSTRAINT user_appearance_preferences_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.user_my_day_widgets
    ADD CONSTRAINT user_my_day_widgets_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.user_navigation_preferences
    ADD CONSTRAINT user_navigation_preferences_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.user_provider_credential_audit_events
    ADD CONSTRAINT user_provider_credential_audit_events_actor_principal_id_fkey FOREIGN KEY (actor_principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.user_provider_credential_audit_events
    ADD CONSTRAINT user_provider_credential_audit_events_owner_principal_id_fkey FOREIGN KEY (owner_principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.user_provider_credentials
    ADD CONSTRAINT user_provider_credentials_created_by_principal_id_fkey FOREIGN KEY (created_by_principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.user_provider_credentials
    ADD CONSTRAINT user_provider_credentials_owner_principal_id_fkey FOREIGN KEY (owner_principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.user_provider_credentials
    ADD CONSTRAINT user_provider_credentials_updated_by_principal_id_fkey FOREIGN KEY (updated_by_principal_id) REFERENCES savia_core.identity_principal(id) ON DELETE RESTRICT;
ALTER TABLE ONLY savia_core.workflow_executions
    ADD CONSTRAINT workflow_executions_workspace_id_version_id_fkey FOREIGN KEY (workspace_id, version_id) REFERENCES savia_core.workflow_versions(workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_jobs
    ADD CONSTRAINT workflow_jobs_workspace_id_execution_id_fkey FOREIGN KEY (workspace_id, execution_id) REFERENCES savia_core.workflow_executions(workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_tasks
    ADD CONSTRAINT workflow_tasks_workspace_id_execution_id_fkey FOREIGN KEY (workspace_id, execution_id) REFERENCES savia_core.workflow_executions(workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_versions
    ADD CONSTRAINT workflow_versions_workspace_id_workflow_id_fkey FOREIGN KEY (workspace_id, workflow_id) REFERENCES savia_core.workflows(workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_webhook_admissions
    ADD CONSTRAINT workflow_webhook_admissions_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES savia_core.workflow_webhook_endpoints(id);
ALTER TABLE ONLY savia_core.workflow_webhook_attempts
    ADD CONSTRAINT workflow_webhook_attempts_workspace_id_execution_id_node_i_fkey FOREIGN KEY (workspace_id, execution_id, node_id) REFERENCES savia_core.workflow_webhook_deliveries(workspace_id, execution_id, node_id);
ALTER TABLE ONLY savia_core.workflow_webhook_deliveries
    ADD CONSTRAINT workflow_webhook_deliveries_workspace_id_destination_id_de_fkey FOREIGN KEY (workspace_id, destination_id, destination_revision) REFERENCES savia_core.workflow_webhook_destination_versions(workspace_id, id, revision);
ALTER TABLE ONLY savia_core.workflow_webhook_deliveries
    ADD CONSTRAINT workflow_webhook_deliveries_workspace_id_execution_id_fkey FOREIGN KEY (workspace_id, execution_id) REFERENCES savia_core.workflow_executions(workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_webhook_destination_versions
    ADD CONSTRAINT workflow_webhook_destination_versions_workspace_id_id_fkey FOREIGN KEY (workspace_id, id) REFERENCES savia_core.workflow_webhook_destinations(workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_webhook_endpoints
    ADD CONSTRAINT workflow_webhook_endpoints_workspace_id_workflow_id_fkey FOREIGN KEY (workspace_id, workflow_id) REFERENCES savia_core.workflows(workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_webhook_receipts
    ADD CONSTRAINT workflow_webhook_receipts_workspace_id_endpoint_id_fkey FOREIGN KEY (workspace_id, endpoint_id) REFERENCES savia_core.workflow_webhook_endpoints(workspace_id, id);
ALTER TABLE ONLY savia_core.workflow_webhook_receipts
    ADD CONSTRAINT workflow_webhook_receipts_workspace_id_execution_id_fkey FOREIGN KEY (workspace_id, execution_id) REFERENCES savia_core.workflow_executions(workspace_id, id);
