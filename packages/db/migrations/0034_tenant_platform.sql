CREATE TABLE tenants (
 id BIGINT PRIMARY KEY NOT NULL,
 id_slug TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at)
 SELECT id,id_slug,name,is_active,created_at,updated_at FROM agencies;
--> statement-breakpoint
ALTER TABLE agencies ADD COLUMN tenant_id BIGINT REFERENCES tenants(id);
--> statement-breakpoint
UPDATE agencies SET tenant_id=id;
--> statement-breakpoint
CREATE UNIQUE INDEX agencies_tenant_unique ON agencies(tenant_id);
--> statement-breakpoint
CREATE TRIGGER agency_tenant_identity_insert BEFORE INSERT ON agencies
 WHEN NEW.tenant_id IS NOT NULL AND NEW.tenant_id != NEW.id
 BEGIN SELECT RAISE(ABORT,'Agency profile must use its tenant identity'); END;
--> statement-breakpoint
CREATE TRIGGER agency_tenant_identity_update BEFORE UPDATE OF id,tenant_id ON agencies
 WHEN NEW.id != OLD.id OR NEW.tenant_id IS NULL OR NEW.tenant_id != NEW.id
 BEGIN SELECT RAISE(ABORT,'Agency profile must use its tenant identity'); END;
--> statement-breakpoint
CREATE TRIGGER agency_tenant_create AFTER INSERT ON agencies
 BEGIN
 INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at)
 VALUES(NEW.id,NEW.id_slug,NEW.name,NEW.is_active,NEW.created_at,NEW.updated_at)
 ON CONFLICT(id) DO UPDATE SET id_slug=excluded.id_slug,name=excluded.name,is_active=excluded.is_active,updated_at=excluded.updated_at;
 UPDATE agencies SET tenant_id=NEW.id WHERE id=NEW.id;
 END;
--> statement-breakpoint
CREATE TRIGGER agency_tenant_update AFTER UPDATE OF id_slug,name,is_active,updated_at ON agencies
 WHEN NEW.id_slug != OLD.id_slug OR NEW.name != OLD.name OR NEW.is_active != OLD.is_active OR NEW.updated_at != OLD.updated_at
 BEGIN
 UPDATE tenants SET id_slug=NEW.id_slug,name=NEW.name,is_active=NEW.is_active,updated_at=NEW.updated_at WHERE id=NEW.id;
 END;
--> statement-breakpoint
CREATE TRIGGER tenant_agency_update AFTER UPDATE OF id_slug,name,is_active,updated_at ON tenants
 WHEN NEW.id_slug != OLD.id_slug OR NEW.name != OLD.name OR NEW.is_active != OLD.is_active OR NEW.updated_at != OLD.updated_at
 BEGIN
 UPDATE agencies SET id_slug=NEW.id_slug,name=NEW.name,is_active=NEW.is_active,updated_at=NEW.updated_at WHERE tenant_id=NEW.id;
 END;
--> statement-breakpoint
CREATE TABLE identity_tenant_membership (
 id TEXT PRIMARY KEY NOT NULL,
 principal_id TEXT NOT NULL UNIQUE REFERENCES identity_principal(id) ON DELETE CASCADE,
 tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK (role IN ('agency_admin','tenant_admin','operator','viewer')),
 is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at)
 SELECT id,principal_id,agency_id,role,is_active,created_at,updated_at
 FROM (SELECT *,ROW_NUMBER() OVER (PARTITION BY principal_id ORDER BY is_active DESC,created_at,id) AS membership_rank FROM identity_agency_membership)
 WHERE membership_rank=1;
--> statement-breakpoint
DROP TABLE identity_agency_membership;
--> statement-breakpoint
CREATE INDEX identity_tenant_membership_tenant_index ON identity_tenant_membership(tenant_id);
--> statement-breakpoint
INSERT INTO server_id_sequences(resource,next_id) SELECT 'tenants',COALESCE(MAX(id),0)+1 FROM tenants WHERE true
 ON CONFLICT(resource) DO UPDATE SET next_id=MAX(next_id,excluded.next_id);
