CREATE TABLE tenant_user_limits (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  max_active_users INTEGER CHECK(max_active_users IS NULL OR (typeof(max_active_users)='integer' AND max_active_users>=0)),
  CHECK(tenant_id>0)
);
--> statement-breakpoint
CREATE TRIGGER tenant_user_limit_membership_insert
BEFORE INSERT ON identity_tenant_membership
WHEN NEW.is_active=1
 AND EXISTS(SELECT 1 FROM identity_principal WHERE id=NEW.principal_id AND is_active=1)
 AND NOT EXISTS(SELECT 1 FROM identity_tenant_membership WHERE principal_id=NEW.principal_id AND tenant_id=NEW.tenant_id AND is_active=1)
BEGIN
 SELECT RAISE(ABORT,'TENANT_ACTIVE_USER_LIMIT_REACHED') WHERE EXISTS(
   SELECT 1 FROM tenant_user_limits l WHERE l.tenant_id=NEW.tenant_id AND l.max_active_users IS NOT NULL
   AND (SELECT COUNT(*) FROM identity_tenant_membership m JOIN identity_principal p ON p.id=m.principal_id
        WHERE m.tenant_id=NEW.tenant_id AND m.is_active=1 AND p.is_active=1)>=l.max_active_users
 );
END;
--> statement-breakpoint
CREATE TRIGGER tenant_user_limit_membership_update
BEFORE UPDATE OF tenant_id,is_active,principal_id ON identity_tenant_membership
WHEN NEW.is_active=1 AND (OLD.is_active<>1 OR OLD.tenant_id<>NEW.tenant_id OR OLD.principal_id<>NEW.principal_id)
 AND EXISTS(SELECT 1 FROM identity_principal WHERE id=NEW.principal_id AND is_active=1)
BEGIN
 SELECT RAISE(ABORT,'TENANT_ACTIVE_USER_LIMIT_REACHED') WHERE EXISTS(
   SELECT 1 FROM tenant_user_limits l WHERE l.tenant_id=NEW.tenant_id AND l.max_active_users IS NOT NULL
   AND (SELECT COUNT(*) FROM identity_tenant_membership m JOIN identity_principal p ON p.id=m.principal_id
        WHERE m.tenant_id=NEW.tenant_id AND m.principal_id<>OLD.principal_id AND m.is_active=1 AND p.is_active=1)>=l.max_active_users
 );
END;
--> statement-breakpoint
CREATE TRIGGER tenant_user_limit_principal_reactivate
BEFORE UPDATE OF is_active ON identity_principal
WHEN NEW.is_active=1 AND OLD.is_active<>1
BEGIN
 SELECT RAISE(ABORT,'TENANT_ACTIVE_USER_LIMIT_REACHED') WHERE EXISTS(
   SELECT 1 FROM identity_tenant_membership own JOIN tenant_user_limits l ON l.tenant_id=own.tenant_id
   WHERE own.principal_id=NEW.id AND own.is_active=1 AND l.max_active_users IS NOT NULL
   AND (SELECT COUNT(*) FROM identity_tenant_membership m JOIN identity_principal p ON p.id=m.principal_id
        WHERE m.tenant_id=own.tenant_id AND m.is_active=1 AND p.is_active=1)>=l.max_active_users
 );
END;
