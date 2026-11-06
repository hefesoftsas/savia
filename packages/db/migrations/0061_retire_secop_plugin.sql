-- Retain recoverable package history without exposing retired executable code
-- through the active catalog. Business collections and records are untouched.
CREATE TABLE retired_secop_installations AS
SELECT * FROM studio_extension_installations WHERE id = 'procurement.secop';
--> statement-breakpoint
CREATE TABLE retired_secop_artifacts AS
SELECT * FROM plugin_store_artifacts WHERE id = 'procurement.secop';
--> statement-breakpoint
CREATE TABLE retired_secop_sources AS
SELECT * FROM plugin_store_sources WHERE id = 'procurement.secop';
--> statement-breakpoint
DELETE FROM studio_extension_installations WHERE id = 'procurement.secop';
--> statement-breakpoint
DELETE FROM plugin_store_sources WHERE id = 'procurement.secop';
--> statement-breakpoint
DELETE FROM plugin_store_artifacts WHERE id = 'procurement.secop';
