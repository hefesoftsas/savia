-- Drop FK constraints from the 5 live customer tables to the 4 retired legacy parents,
-- then drop the parents. Matches SQLite migration 0071. Additive follow-up to the frozen
-- 0001_baseline.sql (never edit an applied migration).
-- See docs/superpowers/plans/2026-09-24-legacy-tables-cleanup.md.
ALTER TABLE "customer_clientagency" DROP CONSTRAINT "customer_clientagenc_commercial_unit_id_c62e178e_fk_business_";
ALTER TABLE "customer_clientagency" DROP CONSTRAINT "customer_clientagency_client_id_f7514a49_fk_customer_client_id";
ALTER TABLE "customer_clientagency" DROP CONSTRAINT "customer_clientagency_group_id_45d26c9d_fk_customer_group_id";
ALTER TABLE "customer_legalperson" DROP CONSTRAINT "customer_legalperson_business_activity_id_fbcde3c5_fk_app_econo";
DROP TABLE IF EXISTS "app_economicactivity";
DROP TABLE IF EXISTS "business_commercialunit";
DROP TABLE IF EXISTS "customer_client";
DROP TABLE IF EXISTS "customer_group";
