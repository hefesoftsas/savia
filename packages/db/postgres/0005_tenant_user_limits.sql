CREATE TABLE tenant_user_limits (
  tenant_id bigint PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  max_active_users bigint CHECK(max_active_users IS NULL OR max_active_users>=0),
  CHECK(tenant_id>0)
);

CREATE FUNCTION savia_check_tenant_user_capacity(target_tenant bigint, excluded_principal text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE user_limit bigint; active_count bigint;
BEGIN
  -- Serialize admissions even when a tenant has no explicit limit row yet.
  PERFORM id FROM tenants WHERE id=target_tenant FOR UPDATE;
  SELECT max_active_users INTO user_limit FROM tenant_user_limits WHERE tenant_id=target_tenant;
  IF user_limit IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO active_count
    FROM identity_tenant_membership m JOIN identity_principal p ON p.id=m.principal_id
    WHERE m.tenant_id=target_tenant AND m.is_active=1 AND p.is_active=1
      AND (excluded_principal IS NULL OR m.principal_id<>excluded_principal);
  IF active_count>=user_limit THEN
    RAISE EXCEPTION 'TENANT_ACTIVE_USER_LIMIT_REACHED' USING ERRCODE='23514';
  END IF;
END;
$$;

CREATE FUNCTION savia_guard_tenant_user_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active<>1 OR NOT EXISTS(SELECT 1 FROM identity_principal WHERE id=NEW.principal_id AND is_active=1) THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM identity_tenant_membership WHERE principal_id=NEW.principal_id AND tenant_id=NEW.tenant_id AND is_active=1) THEN RETURN NEW; END IF;
    PERFORM savia_check_tenant_user_capacity(NEW.tenant_id);
  ELSE
    IF OLD.is_active=1 AND OLD.tenant_id=NEW.tenant_id AND OLD.principal_id=NEW.principal_id THEN RETURN NEW; END IF;
    PERFORM savia_check_tenant_user_capacity(NEW.tenant_id, OLD.principal_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_user_limit_membership_insert BEFORE INSERT ON identity_tenant_membership
FOR EACH ROW EXECUTE FUNCTION savia_guard_tenant_user_membership();
CREATE TRIGGER tenant_user_limit_membership_update BEFORE UPDATE OF tenant_id,is_active,principal_id ON identity_tenant_membership
FOR EACH ROW EXECUTE FUNCTION savia_guard_tenant_user_membership();

CREATE FUNCTION savia_guard_tenant_user_reactivation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_tenant bigint;
BEGIN
  IF NEW.is_active=1 AND OLD.is_active<>1 THEN
    FOR target_tenant IN SELECT tenant_id FROM identity_tenant_membership WHERE principal_id=NEW.id AND is_active=1 ORDER BY tenant_id LOOP
      PERFORM savia_check_tenant_user_capacity(target_tenant, NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tenant_user_limit_principal_reactivate BEFORE UPDATE OF is_active ON identity_principal
FOR EACH ROW EXECUTE FUNCTION savia_guard_tenant_user_reactivation();
