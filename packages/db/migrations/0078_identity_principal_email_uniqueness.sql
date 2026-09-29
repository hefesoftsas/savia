CREATE TRIGGER identity_principal_active_email_insert
BEFORE INSERT ON identity_principal
WHEN NEW.is_active <> 0
 AND NOT EXISTS (
   SELECT 1
   FROM identity_principal AS same_identity
   WHERE same_identity.issuer = NEW.issuer
     AND same_identity.subject = NEW.subject
 )
 AND EXISTS (
   SELECT 1
   FROM identity_principal AS existing
   WHERE existing.is_active <> 0
     AND lower(trim(existing.email)) = lower(trim(NEW.email))
     AND NOT (existing.issuer = NEW.issuer AND existing.subject = NEW.subject)
 )
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_EMAIL_CONFLICT');
END;
--> statement-breakpoint
CREATE TRIGGER identity_principal_active_email_update
BEFORE UPDATE ON identity_principal
WHEN NEW.is_active <> 0
 AND (OLD.is_active = 0 OR lower(trim(NEW.email)) <> lower(trim(OLD.email)))
 AND EXISTS (
   SELECT 1
   FROM identity_principal AS existing
   WHERE existing.id <> OLD.id
     AND existing.is_active <> 0
     AND lower(trim(existing.email)) = lower(trim(NEW.email))
 )
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_EMAIL_CONFLICT');
END;
