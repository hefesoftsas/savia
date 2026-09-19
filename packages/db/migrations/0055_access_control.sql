CREATE TABLE access_revisions (scope TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0));
--> statement-breakpoint
CREATE TABLE access_roles (
 id TEXT NOT NULL, scope TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), protected INTEGER NOT NULL DEFAULT 0 CHECK(protected IN (0,1)),
 legacy_role TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(scope,id), UNIQUE(scope,name), FOREIGN KEY(scope) REFERENCES access_revisions(scope)
);
--> statement-breakpoint
CREATE TABLE access_grants (
 id TEXT PRIMARY KEY, scope TEXT NOT NULL, role_id TEXT NOT NULL, resource TEXT NOT NULL, action TEXT NOT NULL,
 predicate TEXT NOT NULL CHECK(json_valid(predicate)), fields TEXT NOT NULL CHECK(json_valid(fields)),
 FOREIGN KEY(scope,role_id) REFERENCES access_roles(scope,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX access_grants_role ON access_grants(scope,role_id);
--> statement-breakpoint
CREATE TABLE access_assignments (
 scope TEXT NOT NULL, principal_id TEXT NOT NULL, role_id TEXT NOT NULL,
 PRIMARY KEY(scope,principal_id,role_id),
 FOREIGN KEY(scope,role_id) REFERENCES access_roles(scope,id) ON DELETE CASCADE,
 FOREIGN KEY(principal_id) REFERENCES identity_principal(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE access_audit (
 id TEXT PRIMARY KEY, scope TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL,
 before_state TEXT, after_state TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE INDEX access_audit_scope ON access_audit(scope,created_at);
--> statement-breakpoint
INSERT INTO access_revisions(scope) VALUES ('platform');
--> statement-breakpoint
INSERT INTO access_revisions(scope) SELECT 'tenant:'||id FROM tenants WHERE id>0;
--> statement-breakpoint
INSERT INTO access_revisions(scope) SELECT 'domain:'||id FROM crm_data_domains;
--> statement-breakpoint
INSERT INTO access_roles(id,scope,name,label,protected,legacy_role)
SELECT 'builtin:tenant:'||t.id||':'||r.name,'tenant:'||t.id,r.name,r.name,1,r.name
FROM tenants t CROSS JOIN (SELECT 'tenant_admin' name UNION ALL SELECT 'agency_admin' UNION ALL SELECT 'operator' UNION ALL SELECT 'viewer') r WHERE t.id>0;
--> statement-breakpoint
INSERT INTO access_assignments(scope,principal_id,role_id)
SELECT 'tenant:'||m.tenant_id,m.principal_id,'builtin:tenant:'||m.tenant_id||':'||m.role FROM identity_tenant_membership m WHERE m.tenant_id>0;
--> statement-breakpoint
CREATE TRIGGER access_tenant_created AFTER INSERT ON tenants WHEN NEW.id>0 BEGIN
 INSERT OR IGNORE INTO access_revisions(scope) VALUES ('tenant:'||NEW.id);
 INSERT INTO access_roles(id,scope,name,label,protected,legacy_role)
 SELECT 'builtin:tenant:'||NEW.id||':'||r.name,'tenant:'||NEW.id,r.name,r.name,1,r.name
 FROM (SELECT 'tenant_admin' name UNION ALL SELECT 'agency_admin' UNION ALL SELECT 'operator' UNION ALL SELECT 'viewer') r;
END;
--> statement-breakpoint
CREATE TRIGGER access_domain_created AFTER INSERT ON crm_data_domains BEGIN
 INSERT OR IGNORE INTO access_revisions(scope) VALUES ('domain:'||NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER access_membership_created AFTER INSERT ON identity_tenant_membership WHEN NEW.tenant_id>0 BEGIN
 INSERT OR IGNORE INTO access_assignments(scope,principal_id,role_id)
 VALUES('tenant:'||NEW.tenant_id,NEW.principal_id,'builtin:tenant:'||NEW.tenant_id||':'||NEW.role);
 UPDATE access_revisions SET revision=revision+1 WHERE scope='tenant:'||NEW.tenant_id;
END;
--> statement-breakpoint
CREATE TRIGGER access_membership_changed AFTER UPDATE OF tenant_id,role,is_active ON identity_tenant_membership BEGIN
 DELETE FROM access_assignments WHERE principal_id=OLD.principal_id AND scope='tenant:'||OLD.tenant_id
 AND (OLD.tenant_id<>NEW.tenant_id OR role_id LIKE 'builtin:%');
 INSERT OR IGNORE INTO access_assignments(scope,principal_id,role_id)
 SELECT 'tenant:'||NEW.tenant_id,NEW.principal_id,'builtin:tenant:'||NEW.tenant_id||':'||NEW.role WHERE NEW.tenant_id>0;
 UPDATE access_revisions SET revision=revision+1 WHERE scope IN ('tenant:'||OLD.tenant_id,'tenant:'||NEW.tenant_id);
END;
--> statement-breakpoint
CREATE TRIGGER access_membership_removed AFTER DELETE ON identity_tenant_membership BEGIN
 DELETE FROM access_assignments WHERE principal_id=OLD.principal_id AND scope='tenant:'||OLD.tenant_id;
 UPDATE access_revisions SET revision=revision+1 WHERE scope='tenant:'||OLD.tenant_id;
END;
--> statement-breakpoint
CREATE TRIGGER access_principal_changed AFTER UPDATE OF is_active ON identity_principal BEGIN
 UPDATE access_revisions SET revision=revision+1 WHERE scope IN (SELECT scope FROM access_assignments WHERE principal_id=NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER access_global_role_removed AFTER DELETE ON identity_global_role BEGIN
 UPDATE access_revisions SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER access_global_role_added AFTER INSERT ON identity_global_role BEGIN
 UPDATE access_revisions SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER access_tenant_state_changed AFTER UPDATE OF is_active,kind ON tenants BEGIN
 UPDATE access_revisions SET revision=revision+1 WHERE scope='tenant:'||NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER access_domain_removed AFTER DELETE ON crm_data_domains BEGIN
 DELETE FROM access_roles WHERE scope='domain:'||OLD.id;
 UPDATE access_revisions SET revision=revision+1 WHERE scope='domain:'||OLD.id;
END;
--> statement-breakpoint
-- IIF avoids an unparenthesized CASE END being mistaken for the trigger END by the remote D1 splitter.
CREATE TRIGGER access_object_changed AFTER UPDATE OF config ON crm_objects BEGIN
 UPDATE access_revisions SET revision=revision+1 WHERE scope=IIF(NEW.tenant_id='domain:platform','platform',IIF(NEW.tenant_id LIKE 'agency:%','tenant:'||substr(NEW.tenant_id,8),NEW.tenant_id));
END;
--> statement-breakpoint
CREATE TRIGGER access_object_removed AFTER DELETE ON crm_objects BEGIN
 UPDATE access_revisions SET revision=revision+1 WHERE scope=IIF(OLD.tenant_id='domain:platform','platform',IIF(OLD.tenant_id LIKE 'agency:%','tenant:'||substr(OLD.tenant_id,8),OLD.tenant_id));
END;
