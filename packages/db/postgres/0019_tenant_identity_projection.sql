-- Complete the native projection of tenant identity tables already used by the application.

ALTER TABLE "agency_crm_connections" RENAME COLUMN "agency_id" TO "tenant_id";

ALTER TABLE "agency_crm_connections" RENAME TO "tenant_crm_connections";

DROP INDEX IF EXISTS "agency_crm_connections_agency_provider_index";

CREATE INDEX "tenant_crm_connections_tenant_provider_index"
  ON "tenant_crm_connections" ("tenant_id", "provider");

DROP INDEX IF EXISTS "agency_crm_connections_owner_index";

CREATE INDEX "tenant_crm_connections_owner_index"
  ON "tenant_crm_connections" ("created_by_principal_id", "tenant_id", "provider");

DROP INDEX IF EXISTS "agency_crm_connections_active_unique";

CREATE UNIQUE INDEX "tenant_crm_connections_active_unique"
  ON "tenant_crm_connections" ("created_by_principal_id", "tenant_id", "provider")
  WHERE "disconnected_at" IS NULL;

ALTER TABLE "agency_crm_connection_audit_events" RENAME COLUMN "agency_id" TO "tenant_id";

ALTER TABLE "agency_crm_connection_audit_events" RENAME TO "tenant_crm_connection_audit_events";

CREATE INDEX IF NOT EXISTS "tenant_crm_connection_audit_events_connection_created_at_index"
  ON "tenant_crm_connection_audit_events" ("connection_id", "created_at");

CREATE INDEX IF NOT EXISTS "tenant_crm_connection_audit_events_tenant_created_at_index"
  ON "tenant_crm_connection_audit_events" ("tenant_id", "created_at");

ALTER TABLE "assistant_active_agencies" RENAME COLUMN "agency_id" TO "tenant_id";

ALTER TABLE "assistant_active_agencies" RENAME TO "assistant_active_tenants";

CREATE INDEX IF NOT EXISTS "assistant_active_tenants_tenant_index"
  ON "assistant_active_tenants" ("tenant_id");

CREATE VIEW "agency_crm_connections" AS
  SELECT "id", "tenant_id" AS "agency_id", "created_by_principal_id", "provider",
         "nango_connection_id", "nango_integration_id", "status",
         "external_account_label", "scopes", "last_validated_at",
         "disconnected_at", "created_at", "updated_at", "external_account_id"
  FROM "tenant_crm_connections";

CREATE FUNCTION agency_crm_connections_insert_fn() RETURNS trigger LANGUAGE plpgsql SET search_path=savia_core,pg_catalog AS $$ BEGIN
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

CREATE TRIGGER "agency_crm_connections_insert" INSTEAD OF INSERT ON "agency_crm_connections" FOR EACH ROW EXECUTE FUNCTION agency_crm_connections_insert_fn();

CREATE FUNCTION agency_crm_connections_update_fn() RETURNS trigger LANGUAGE plpgsql SET search_path=savia_core,pg_catalog AS $$ BEGIN
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

CREATE TRIGGER "agency_crm_connections_update" INSTEAD OF UPDATE ON "agency_crm_connections" FOR EACH ROW EXECUTE FUNCTION agency_crm_connections_update_fn();

CREATE FUNCTION agency_crm_connections_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path=savia_core,pg_catalog AS $$ BEGIN
DELETE FROM "tenant_crm_connections" WHERE "id" = OLD."id";
RETURN OLD;
END $$;

CREATE TRIGGER "agency_crm_connections_delete" INSTEAD OF DELETE ON "agency_crm_connections" FOR EACH ROW EXECUTE FUNCTION agency_crm_connections_delete_fn();

CREATE VIEW "agency_crm_connection_audit_events" AS
  SELECT "id", "connection_id", "tenant_id" AS "agency_id", "principal_id", "provider",
         "event_type", "outcome", "error_code", "created_at"
  FROM "tenant_crm_connection_audit_events";

CREATE FUNCTION agency_crm_connection_audit_events_insert_fn() RETURNS trigger LANGUAGE plpgsql SET search_path=savia_core,pg_catalog AS $$ BEGIN
INSERT INTO "tenant_crm_connection_audit_events" (
    "id", "connection_id", "tenant_id", "principal_id", "provider",
    "event_type", "outcome", "error_code", "created_at"
  ) VALUES (
    NEW."id", NEW."connection_id", NEW."agency_id", NEW."principal_id", NEW."provider",
    NEW."event_type", NEW."outcome", NEW."error_code", NEW."created_at"
  );
RETURN NEW;
END $$;

CREATE TRIGGER "agency_crm_connection_audit_events_insert" INSTEAD OF INSERT ON "agency_crm_connection_audit_events" FOR EACH ROW EXECUTE FUNCTION agency_crm_connection_audit_events_insert_fn();

CREATE VIEW "assistant_active_agencies" AS
  SELECT "principal_id", "tenant_id" AS "agency_id", "updated_at"
  FROM "assistant_active_tenants";

CREATE FUNCTION assistant_active_agencies_insert_fn() RETURNS trigger LANGUAGE plpgsql SET search_path=savia_core,pg_catalog AS $$ BEGIN
INSERT INTO "assistant_active_tenants" ("principal_id", "tenant_id", "updated_at")
  VALUES (NEW."principal_id", NEW."agency_id", NEW."updated_at")
  ON CONFLICT("principal_id") DO UPDATE SET
    "tenant_id" = excluded."tenant_id",
    "updated_at" = excluded."updated_at";
RETURN NEW;
END $$;

CREATE TRIGGER "assistant_active_agencies_insert" INSTEAD OF INSERT ON "assistant_active_agencies" FOR EACH ROW EXECUTE FUNCTION assistant_active_agencies_insert_fn();

CREATE FUNCTION assistant_active_agencies_delete_fn() RETURNS trigger LANGUAGE plpgsql SET search_path=savia_core,pg_catalog AS $$ BEGIN
DELETE FROM "assistant_active_tenants" WHERE "principal_id" = OLD."principal_id";
RETURN OLD;
END $$;

CREATE TRIGGER "assistant_active_agencies_delete" INSTEAD OF DELETE ON "assistant_active_agencies" FOR EACH ROW EXECUTE FUNCTION assistant_active_agencies_delete_fn();
