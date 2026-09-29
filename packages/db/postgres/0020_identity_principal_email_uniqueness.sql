CREATE FUNCTION identity_principal_active_email_guard_fn() RETURNS trigger
LANGUAGE plpgsql VOLATILE
SET search_path=savia_core,pg_catalog
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
--> statement-breakpoint
CREATE TRIGGER identity_principal_active_email_guard
BEFORE INSERT OR UPDATE ON identity_principal
FOR EACH ROW EXECUTE FUNCTION identity_principal_active_email_guard_fn();
