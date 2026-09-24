-- Additive follow-up to the frozen 0001_baseline.sql (never edit an applied migration).
-- Widens tenant_branding_assets for per-tenant login Lottie animations (application/json).
ALTER TABLE tenant_branding_assets DROP CONSTRAINT IF EXISTS tenant_branding_assets_kind_check;
ALTER TABLE tenant_branding_assets ADD CONSTRAINT tenant_branding_assets_kind_check CHECK (kind IN ('logo', 'cover', 'login-animation'));
ALTER TABLE tenant_branding_assets DROP CONSTRAINT IF EXISTS tenant_branding_assets_content_type_check;
ALTER TABLE tenant_branding_assets ADD CONSTRAINT tenant_branding_assets_content_type_check CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'application/json'));
