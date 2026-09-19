-- Preserve revision tombstones and audit history while revoking orphan policies.
UPDATE access_revisions SET revision=revision+1
WHERE scope LIKE 'tenant:%'
 AND NOT EXISTS (SELECT 1 FROM tenants WHERE 'tenant:'||tenants.id=access_revisions.scope);
--> statement-breakpoint
DELETE FROM access_roles
WHERE scope LIKE 'tenant:%'
 AND NOT EXISTS (SELECT 1 FROM tenants WHERE 'tenant:'||tenants.id=access_roles.scope);
--> statement-breakpoint
CREATE TRIGGER access_tenant_removed AFTER DELETE ON tenants WHEN OLD.id>0 BEGIN
 DELETE FROM access_roles WHERE scope='tenant:'||OLD.id;
 UPDATE access_revisions SET revision=revision+1 WHERE scope='tenant:'||OLD.id;
END;
