CREATE TABLE savia_core.retired_secop_installations AS
SELECT * FROM savia_core.studio_extension_installations WHERE id = 'procurement.secop';
--> statement-breakpoint
CREATE TABLE savia_core.retired_secop_artifacts AS
SELECT * FROM savia_core.plugin_store_artifacts WHERE id = 'procurement.secop';
--> statement-breakpoint
CREATE TABLE savia_core.retired_secop_sources AS
SELECT * FROM savia_core.plugin_store_sources WHERE id = 'procurement.secop';
--> statement-breakpoint
DELETE FROM savia_core.studio_extension_installations WHERE id = 'procurement.secop';
--> statement-breakpoint
DELETE FROM savia_core.plugin_store_sources WHERE id = 'procurement.secop';
--> statement-breakpoint
DELETE FROM savia_core.plugin_store_artifacts WHERE id = 'procurement.secop';
