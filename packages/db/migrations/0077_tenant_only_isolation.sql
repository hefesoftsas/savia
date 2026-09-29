-- Tenant-only isolation. Apply in one transaction; guard failures require explicit conflict resolution.
-- Historical mapping is migration provenance, never a runtime workspace catalog.
CREATE TABLE IF NOT EXISTS tenant_namespace_migrations (old_key TEXT PRIMARY KEY, tenant_id BIGINT NOT NULL);
--> statement-breakpoint
INSERT INTO tenant_namespace_migrations(old_key,tenant_id) SELECT 'domain:platform',0 WHERE EXISTS(SELECT 1 FROM tenants WHERE id=0) ON CONFLICT(old_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO tenant_namespace_migrations(old_key,tenant_id) SELECT 'agency:'||id,id FROM tenants WHERE 1=1 ON CONFLICT(old_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO tenant_namespace_migrations(old_key,tenant_id) SELECT 'domain:'||d.id, (SELECT COALESCE(MAX(id),0) FROM tenants)+ROW_NUMBER() OVER(ORDER BY d.id) FROM studio_data_domains d WHERE NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key='domain:'||d.id);
--> statement-breakpoint
CREATE TABLE tenant_namespace_guard (collision INTEGER CONSTRAINT tenant_namespace_collision CHECK(collision=0), membership INTEGER CONSTRAINT tenant_membership_conflict CHECK(membership=0), unmapped INTEGER CONSTRAINT tenant_namespace_unmapped CHECK(unmapped=0));
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_namespace_migrations WHERE (old_key='domain:platform' AND tenant_id<>0) OR (old_key LIKE 'agency:%' AND old_key<>'agency:'||tenant_id) OR tenant_id<0) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(membership) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_assignments a JOIN tenant_namespace_migrations m ON m.old_key=a.scope WHERE a.scope LIKE 'domain:%' AND NOT EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=a.principal_id AND g.role='platform_admin') AND NOT EXISTS(SELECT 1 FROM identity_tenant_membership i WHERE i.principal_id=a.principal_id AND i.tenant_id=m.tenant_id AND i.is_active=1)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_objects s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_objects s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."name" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_records s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_records s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_views s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_integrations s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_audit s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_unique_values s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_unique_values s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."field_name",s."value" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_requests s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_requests s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."request_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_schema_versions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_schema_versions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."version" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_schema_data s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_schema_data s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."version",s."record_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_integration_runs s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_integration_runs s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."integration_id",s."operation_id",s."idempotency_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_notes s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_files s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_automations s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_automation_runs s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_automation_runs s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."automation_id",s."event_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_tasks s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_business_links s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_business_links s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."record_id",s."connection_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM managed_customer_extensions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM managed_customer_extensions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."profile_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM managed_customer_requests s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM managed_customer_requests s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."request_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_collection_bindings s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_collection_bindings s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_requests s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_requests s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."request_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_relations s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_relations s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_links s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_links s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."relation_id",s."source_id",s."target_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_native_relation_overrides s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_native_relation_overrides s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_file_drafts s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_settings s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_settings s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id) HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_solution_installations s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_solution_installations s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_solution_objects s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_solution_objects s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_geocoding_settings s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_geocoding_settings s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id) HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_extension_installations s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_extension_installations s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_connections s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_connections s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."extension_id",s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_connection_audit_events s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_action_runs s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_action_runs s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."run_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_settings s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_settings s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."extension_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_versions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_versions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."collection" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_sync_changes s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_sync_changes s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_sync_receipts s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_sync_receipts s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."principal_id",s."mutation_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM public_forms s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM public_form_submissions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflows s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflows s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_versions s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_versions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_versions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."workflow_id",s."revision" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_events s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_executions s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_executions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_executions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."workflow_id",s."event_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_jobs s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_jobs s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."execution_id",s."node_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_tasks s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_tasks s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."execution_id",s."node_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_tasks s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_write_context s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_write_context s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."record_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_roles s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_roles s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_roles s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s."name" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_grants s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_assignments s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_assignments s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s."principal_id",s."role_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_audit s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_sources s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_sources s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."owner_principal_id",s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_file_revisions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_file_revisions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."file_id",s."version" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_access_deliveries s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_access_deliveries s GROUP BY s."principal_id",COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s."revision",s."object_name",s."record_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_history s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_history s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."record_id",s."version" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_history_context s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_history_context s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id) HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_endpoints s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_endpoints s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_endpoints s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."workflow_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_receipts s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_receipts s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."endpoint_id",s."event_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_destinations s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_destinations s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_destination_versions s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_destination_versions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id",s."revision" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_deliveries s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_deliveries s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."execution_id",s."node_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_attempts s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_attempts s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."execution_id",s."node_id",s."sequence" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_subscriptions s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_subscriptions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."principal_id",s."collection" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_admin_audit s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_send_limits s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_send_limits s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."actor_id",s."window_start" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_scope_settings s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_scope_settings s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id) HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flows s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flows s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."flow_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flow_variables s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flow_variables s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."flow_id",s."key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flow_versions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flow_runs s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_folders s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_folders s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."path" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_bundles s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_bundles s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM bundle_flow_state s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM bundle_flow_state s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s."flow_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM savia_request_audit s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM plugin_store_artifacts s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM plugin_store_artifacts s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id",s."version" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_events s WHERE s.scope_kind='workspace' AND (s.scope_id LIKE 'domain:%' OR s.scope_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_events s GROUP BY s."scope_kind",CASE WHEN s.scope_kind='workspace' THEN COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope_id),s.scope_id) ELSE s.scope_id END,s."event_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_deliveries s WHERE s.scope_kind='workspace' AND (s.scope_id LIKE 'domain:%' OR s.scope_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_roles r JOIN tenant_namespace_migrations m ON m.old_key=r.scope WHERE NOT EXISTS(SELECT 1 FROM tenants t WHERE t.id=m.tenant_id) AND r.name IN ('tenant_admin','agency_admin','operator','viewer')) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) SELECT m.tenant_id,'workspace-'||m.tenant_id,d.label,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'commercial' FROM studio_data_domains d JOIN tenant_namespace_migrations m ON m.old_key='domain:'||d.id WHERE NOT EXISTS(SELECT 1 FROM tenants t WHERE t.id=m.tenant_id);
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(membership) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_assignments a WHERE a.scope='platform' AND NOT EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=a.principal_id AND g.role='platform_admin')) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM request_page_runs r WHERE r.domain_id NOT LIKE 'tenant:%' AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=r.domain_id OR m.old_key='domain:'||r.domain_id)) THEN 1 ELSE 0 END;
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
DROP TRIGGER "access_domain_created";
--> statement-breakpoint
DROP TRIGGER "access_domain_removed";
--> statement-breakpoint
DROP TRIGGER "access_object_changed";
--> statement-breakpoint
DROP TRIGGER "access_object_removed";
--> statement-breakpoint
DROP TRIGGER "crm_sync_insert";
--> statement-breakpoint
DROP TRIGGER "crm_sync_update";
--> statement-breakpoint
DROP TRIGGER "crm_sync_delete";
--> statement-breakpoint
DROP TRIGGER "workflow_record_created";
--> statement-breakpoint
DROP TRIGGER "workflow_record_updated";
--> statement-breakpoint
DROP TRIGGER "workflow_record_deleted";
--> statement-breakpoint
DROP TRIGGER "workflow_record_hard_deleted";
--> statement-breakpoint
DROP TRIGGER "workflow_event_dispatch";
--> statement-breakpoint
DROP TRIGGER "notification_record_insert";
--> statement-breakpoint
DROP TRIGGER "notification_record_update";
--> statement-breakpoint
DROP TRIGGER "notification_record_purge";
--> statement-breakpoint
DROP TRIGGER "notification_event_fanout";
--> statement-breakpoint
DROP TRIGGER "studio_record_links_cardinality";
--> statement-breakpoint
DROP TRIGGER "studio_relation_definition_update";
--> statement-breakpoint
DROP TRIGGER "studio_record_links_storage";
--> statement-breakpoint
DROP TRIGGER "studio_history_insert";
--> statement-breakpoint
DROP TRIGGER "studio_history_update";
--> statement-breakpoint
DROP TRIGGER "studio_history_delete";
--> statement-breakpoint
UPDATE studio_integrations AS s SET encrypted_secret=(SELECT json_object('version',2,'context','tenant:'||m.tenant_id||':'||s.owner_principal_id||':'||s.id,'aad',s.tenant_id||':'||s.owner_principal_id||':'||s.id,'value',s.encrypted_secret) FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE encrypted_secret IS NOT NULL AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_collection_sources AS s SET encrypted_secret=(SELECT json_object('version',2,'context','['||json_quote(('tenant:'||m.tenant_id))||','||json_quote(s.owner_principal_id)||']:collection-source:'||s.id,'aad','['||json_quote(s.tenant_id)||','||json_quote(s.owner_principal_id)||']:collection-source:'||s.id,'value',s.encrypted_secret) FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE encrypted_secret IS NOT NULL AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_geocoding_settings AS s SET encrypted_geoapify_key=(SELECT json_object('version',2,'context','tenant:'||m.tenant_id||':geocoding','aad',s.tenant_id||':geocoding','value',s.encrypted_geoapify_key) FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE encrypted_geoapify_key IS NOT NULL AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE workflow_webhook_destinations AS s SET encrypted_secret=(SELECT json_object('version',2,'context','workflow-webhook:tenant:'||m.tenant_id||':'||s.id,'aad','workflow-webhook:'||s.workspace_id||':'||s.id,'value',s.encrypted_secret) FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE encrypted_secret IS NOT NULL AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE extension_connections AS s SET credential_ciphertext=(SELECT json_object('version',2,'context','savia/extensions/connection/v1/tenant:'||m.tenant_id||'/'||s.extension_id||'/'||s.id||'/'||s.connector_id,'aad','savia/extensions/connection/v1/'||s.tenant_id||'/'||s.extension_id||'/'||s.id||'/'||s.connector_id,'value',s.credential_ciphertext) FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE credential_ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
INSERT INTO access_revisions(scope,revision) SELECT 'tenant:'||m.tenant_id,MAX(r.revision)+1 FROM access_revisions r JOIN tenant_namespace_migrations m ON m.old_key=r.scope GROUP BY m.tenant_id HAVING 1=1 ON CONFLICT(scope) DO UPDATE SET revision=MAX(access_revisions.revision,excluded.revision);
--> statement-breakpoint
INSERT INTO access_revisions(scope,revision) SELECT 'tenant:0',1 WHERE EXISTS(SELECT 1 FROM tenants WHERE id=0) ON CONFLICT(scope) DO NOTHING;
--> statement-breakpoint
UPDATE studio_objects AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_records AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_views AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_integrations AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_audit AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_unique_values AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_requests AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_schema_versions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_schema_data AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_integration_runs AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_notes AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_files AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_automations AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_automation_runs AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_tasks AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_business_links AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE managed_customer_extensions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE managed_customer_requests AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE crm_collection_bindings AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_collection_requests AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_collection_relations AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_record_links AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_native_relation_overrides AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_file_drafts AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_settings AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_solution_installations AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_solution_objects AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_geocoding_settings AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_extension_installations AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE extension_connections AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE extension_connection_audit_events AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE extension_action_runs AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE extension_settings AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_collection_versions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE crm_sync_changes AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE crm_sync_receipts AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE public_forms AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE public_form_submissions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE workflows AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_versions AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_events AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_executions AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_jobs AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_tasks AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_write_context AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE access_roles AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);
--> statement-breakpoint
UPDATE access_grants AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);
--> statement-breakpoint
UPDATE access_assignments AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);
--> statement-breakpoint
UPDATE access_audit AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);
--> statement-breakpoint
UPDATE studio_collection_sources AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_file_revisions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_access_deliveries AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);
--> statement-breakpoint
UPDATE studio_record_history AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE studio_record_history_context AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE workflow_webhook_endpoints AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_webhook_receipts AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_webhook_destinations AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_webhook_destination_versions AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_webhook_deliveries AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE workflow_webhook_attempts AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE notification_subscriptions AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE notification_admin_audit AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE notification_send_limits AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE notification_scope_settings AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);
--> statement-breakpoint
UPDATE tenant_flows AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE tenant_flow_variables AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE tenant_flow_versions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE tenant_flow_runs AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE tenant_folders AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE tenant_bundles AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE bundle_flow_state AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);
--> statement-breakpoint
UPDATE savia_request_audit AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE plugin_store_artifacts AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);
--> statement-breakpoint
UPDATE notification_events AS s SET scope_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id) WHERE s.scope_kind='workspace' AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id);
--> statement-breakpoint
UPDATE notification_deliveries AS s SET scope_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id) WHERE s.scope_kind='workspace' AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id);
--> statement-breakpoint
UPDATE notification_events AS s SET payload=(SELECT json_set(s.payload,'$.scope.id','tenant:'||m.tenant_id) FROM tenant_namespace_migrations m WHERE m.old_key=json_extract(s.payload,'$.scope.id')) WHERE s.scope_kind='workspace' AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=json_extract(s.payload,'$.scope.id'));
--> statement-breakpoint
DELETE FROM access_revisions WHERE scope IN (SELECT old_key FROM tenant_namespace_migrations);
--> statement-breakpoint
ALTER TABLE public_forms DROP COLUMN domain_id;
--> statement-breakpoint
ALTER TABLE request_page_runs RENAME COLUMN domain_id TO tenant_id;
--> statement-breakpoint
UPDATE request_page_runs AS s SET tenant_id=COALESCE((SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=CASE WHEN s.tenant_id LIKE 'agency:%' OR s.tenant_id LIKE 'domain:%' THEN s.tenant_id ELSE 'domain:'||s.tenant_id END),s.tenant_id);
--> statement-breakpoint
WITH RECURSIVE replacements(pos,old_path,new_path,old_page,new_page) AS (SELECT ROW_NUMBER() OVER(ORDER BY old_key),CASE WHEN old_key LIKE 'domain:%' THEN '/v1/data-domains/'||substr(old_key,8) ELSE '/v1/dynamic-crm/'||tenant_id END,'/v1/studio/'||tenant_id,CASE WHEN old_key LIKE 'domain:%' THEN substr(old_key,8) ELSE 'tenant%3A'||tenant_id END,CAST(tenant_id AS TEXT) FROM tenant_namespace_migrations), rewritten(principal_id,pos,value) AS (SELECT principal_id,0,layout FROM user_my_day_widgets UNION ALL SELECT r.principal_id,r.pos+1,replace(replace(replace(r.value,'"'||p.old_path||'"','"'||p.new_path||'"'),'"page:'||p.old_page||':','"page:'||p.new_page||':'),'"page:agency%3A'||p.new_page||':','"page:'||p.new_page||':') FROM rewritten r JOIN replacements p ON p.pos=r.pos+1) UPDATE user_my_day_widgets SET layout=(SELECT value FROM rewritten r WHERE r.principal_id=user_my_day_widgets.principal_id ORDER BY pos DESC LIMIT 1);
--> statement-breakpoint
WITH RECURSIVE replacements(pos,old_path,new_path,old_page,new_page) AS (SELECT ROW_NUMBER() OVER(ORDER BY old_key),CASE WHEN old_key LIKE 'domain:%' THEN '/v1/data-domains/'||substr(old_key,8) ELSE '/v1/dynamic-crm/'||tenant_id END,'/v1/studio/'||tenant_id,CASE WHEN old_key LIKE 'domain:%' THEN substr(old_key,8) ELSE 'tenant%3A'||tenant_id END,CAST(tenant_id AS TEXT) FROM tenant_namespace_migrations), rewritten(principal_id,pos,value) AS (SELECT principal_id,0,layout FROM user_navigation_preferences UNION ALL SELECT r.principal_id,r.pos+1,replace(replace(replace(r.value,'"'||p.old_path||'"','"'||p.new_path||'"'),'"page:'||p.old_page||':','"page:'||p.new_page||':'),'"page:agency%3A'||p.new_page||':','"page:'||p.new_page||':') FROM rewritten r JOIN replacements p ON p.pos=r.pos+1) UPDATE user_navigation_preferences SET layout=(SELECT value FROM rewritten r WHERE r.principal_id=user_navigation_preferences.principal_id ORDER BY pos DESC LIMIT 1);
--> statement-breakpoint
DROP TABLE studio_data_domains;
--> statement-breakpoint
CREATE TRIGGER access_object_changed AFTER UPDATE OF config ON "studio_objects" BEGIN
 UPDATE access_revisions SET revision=revision+1 WHERE scope=NEW.tenant_id;
END;
--> statement-breakpoint
CREATE TRIGGER access_object_removed AFTER DELETE ON "studio_objects" BEGIN
 UPDATE access_revisions SET revision=revision+1 WHERE scope=OLD.tenant_id;
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_insert AFTER INSERT ON "studio_records" BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.data,NEW.version,NEW.created_at,NEW.updated_at,NEW.deleted_at,NEW.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_update AFTER UPDATE ON "studio_records" BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (NEW.tenant_id,NEW.object_name,NEW.id,NEW.data,NEW.version,NEW.created_at,NEW.updated_at,NEW.deleted_at,NEW.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
END;
--> statement-breakpoint
CREATE TRIGGER crm_sync_delete AFTER DELETE ON "studio_records" BEGIN
 INSERT INTO crm_sync_changes(tenant_id,object_name,id,data,version,created_at,updated_at,deleted_at,created_by) VALUES (OLD.tenant_id,OLD.object_name,OLD.id,OLD.data,OLD.version+1,OLD.created_at,OLD.updated_at,COALESCE(OLD.deleted_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),OLD.created_by) ON CONFLICT(tenant_id,object_name,id) DO UPDATE SET sequence=excluded.sequence,data=excluded.data,version=excluded.version,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,created_by=excluded.created_by;
END;
--> statement-breakpoint
CREATE TRIGGER workflow_record_created AFTER INSERT ON "studio_records"
 WHEN NEW.deleted_at IS NULL AND EXISTS (
 SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.tenant_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type') IN ('created','created_or_updated')
 AND json_extract(v.definition,'$.trigger.collection')=NEW.object_name)
 BEGIN
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT NEW.tenant_id,NEW.object_name,'created','{}',
 json_set(NEW.data,'$.id',NEW.id,'$._version',NEW.version,'$.created_at',NEW.created_at,'$.updated_at',NEW.updated_at),
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) LEFT JOIN workflow_write_context c ON c.workspace_id=NEW.tenant_id AND c.record_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER workflow_record_updated AFTER UPDATE OF data ON "studio_records"
 WHEN NEW.deleted_at IS NULL AND OLD.deleted_at IS NULL AND NEW.data<>OLD.data AND EXISTS (
 SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.tenant_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type') IN ('updated','created_or_updated')
 AND json_extract(v.definition,'$.trigger.collection')=NEW.object_name)
 BEGIN
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT NEW.tenant_id,NEW.object_name,'updated',
 json_set(OLD.data,'$.id',OLD.id,'$._version',OLD.version,'$.created_at',OLD.created_at,'$.updated_at',OLD.updated_at),
 json_set(NEW.data,'$.id',NEW.id,'$._version',NEW.version,'$.created_at',NEW.created_at,'$.updated_at',NEW.updated_at),
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) LEFT JOIN workflow_write_context c ON c.workspace_id=NEW.tenant_id AND c.record_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER workflow_record_deleted AFTER UPDATE OF deleted_at ON "studio_records"
 WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
 SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=OLD.tenant_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type')='deleted'
 AND json_extract(v.definition,'$.trigger.collection')=OLD.object_name)
 BEGIN
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT OLD.tenant_id,OLD.object_name,'deleted',
 json_set(OLD.data,'$.id',OLD.id,'$._version',OLD.version,'$.created_at',OLD.created_at,'$.updated_at',OLD.updated_at),'{}',
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) LEFT JOIN workflow_write_context c ON c.workspace_id=OLD.tenant_id AND c.record_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER workflow_record_hard_deleted AFTER DELETE ON "studio_records"
 WHEN OLD.deleted_at IS NULL AND EXISTS (
 SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=OLD.tenant_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type')='deleted'
 AND json_extract(v.definition,'$.trigger.collection')=OLD.object_name)
 BEGIN
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT OLD.tenant_id,OLD.object_name,'deleted',
 json_set(OLD.data,'$.id',OLD.id,'$._version',OLD.version,'$.created_at',OLD.created_at,'$.updated_at',OLD.updated_at),'{}',
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) LEFT JOIN workflow_write_context c ON c.workspace_id=OLD.tenant_id AND c.record_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER workflow_event_dispatch AFTER INSERT ON workflow_events WHEN NEW.depth<5 BEGIN
 INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,node_id,context,depth)
 SELECT w.workspace_id,v.id||':'||NEW.id,w.id,v.id,v.owner_id,v.owner_id,'event:'||NEW.id,
 json_extract(v.definition,'$.nodes[0].id'),
 json_object('trigger',json(CASE WHEN NEW.kind='deleted' THEN NEW.before_state ELSE NEW.after_state END),
 'before',json(NEW.before_state),'steps',json('{}'),
 'system',json_object('owner',v.owner_id,'workspace',w.workspace_id,'event',NEW.id,'eventType',NEW.kind,'cause',NEW.cause)),NEW.depth
 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.workspace_id AND w.enabled=1
 AND (json_extract(v.definition,'$.trigger.type')=NEW.kind OR
 (json_extract(v.definition,'$.trigger.type')='created_or_updated' AND NEW.kind IN ('created','updated')))
 AND json_extract(v.definition,'$.trigger.collection')=NEW.collection
 AND (NEW.kind<>'updated' OR COALESCE(json_array_length(v.definition,'$.trigger.changedFields'),0)=0 OR EXISTS (
 SELECT 1 FROM json_each(v.definition,'$.trigger.changedFields') f
 WHERE json_extract(NEW.before_state,'$.'||f.value) IS NOT json_extract(NEW.after_state,'$.'||f.value)
 OR json_type(NEW.before_state,'$.'||f.value) IS NOT json_type(NEW.after_state,'$.'||f.value)))
 AND (COALESCE(json_array_length(v.definition,'$.trigger.conditions'),0)=0 OR (
 SELECT CASE WHEN json_extract(v.definition,'$.trigger.conditionMode')='any' THEN MAX(matched) ELSE MIN(matched) END
 FROM (
 SELECT COALESCE(CASE operator
 WHEN 'eq' THEN actual_type IS NOT NULL AND (actual_type=expected_type OR (actual_type IN ('integer','real') AND expected_type IN ('integer','real'))) AND actual IS expected
 WHEN 'neq' THEN actual_type IS NOT NULL AND NOT ((actual_type=expected_type OR (actual_type IN ('integer','real') AND expected_type IN ('integer','real'))) AND actual IS expected)
 WHEN 'gt' THEN actual_type IN ('integer','real') AND actual>expected
 WHEN 'gte' THEN actual_type IN ('integer','real') AND actual>=expected
 WHEN 'lt' THEN actual_type IN ('integer','real') AND actual<expected
 WHEN 'lte' THEN actual_type IN ('integer','real') AND actual<=expected
 WHEN 'contains' THEN actual_type='text' AND instr(actual,expected)>0
 WHEN 'empty' THEN actual_type IS NULL OR actual_type='null' OR (actual_type='text' AND actual='')
 WHEN 'not_empty' THEN actual_type IS NOT NULL AND actual_type<>'null' AND NOT (actual_type='text' AND actual='')
 ELSE 0 END,0) AS matched
 FROM (
 SELECT json_extract(f.value,'$.operator') AS operator,
 json_extract(f.value,'$.value') AS expected,json_type(f.value,'$.value') AS expected_type,
 json_extract(CASE WHEN NEW.kind='deleted' THEN NEW.before_state ELSE NEW.after_state END,'$.'||json_extract(f.value,'$.field')) AS actual,
 json_type(CASE WHEN NEW.kind='deleted' THEN NEW.before_state ELSE NEW.after_state END,'$.'||json_extract(f.value,'$.field')) AS actual_type
 FROM json_each(v.definition,'$.trigger.conditions') f
 ))));
END;
--> statement-breakpoint
CREATE TRIGGER notification_record_insert AFTER INSERT ON "studio_records"
BEGIN
INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at)
SELECT 'ntf_'||lower(hex(randomblob(8))),'workspace',NEW.tenant_id,
 'record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 json_object('scope',json_object('kind','workspace','id',NEW.tenant_id),'key','record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 'actor',json_object('kind',COALESCE((SELECT actor_kind FROM "studio_record_history_context" WHERE tenant_id=NEW.tenant_id),'system'),'id',(SELECT actor_id FROM "studio_record_history_context" WHERE tenant_id=NEW.tenant_id)),
 'source',json_object('kind','record','collection',NEW.object_name,'id',NEW.id,'operation','created'),
 'title',NEW.object_name||' created','body','',
 'audience',json_object('kind','collection-followers','collection',NEW.object_name),
 'createdAt',CAST(strftime('%s','now') AS INTEGER)*1000,'expiresAt',json('null')),
 CAST(strftime('%s','now') AS INTEGER)*1000
WHERE EXISTS(SELECT 1 FROM notification_subscriptions WHERE workspace_id=NEW.tenant_id AND collection=NEW.object_name);
END;
--> statement-breakpoint
CREATE TRIGGER notification_record_update AFTER UPDATE ON "studio_records"
WHEN OLD.data IS NOT NEW.data OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
BEGIN
INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at)
SELECT 'ntf_'||lower(hex(randomblob(8))),'workspace',NEW.tenant_id,
 'record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 json_object('scope',json_object('kind','workspace','id',NEW.tenant_id),'key','record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 'actor',json_object('kind',COALESCE((SELECT actor_kind FROM "studio_record_history_context" WHERE tenant_id=NEW.tenant_id),'system'),'id',(SELECT actor_id FROM "studio_record_history_context" WHERE tenant_id=NEW.tenant_id)),
 'source',json_object('kind','record','collection',NEW.object_name,'id',NEW.id,'operation',
  CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'created' ELSE 'updated' END),
 'title',NEW.object_name||' '||CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restored' ELSE 'updated' END,'body','',
 'audience',json_object('kind','collection-followers','collection',NEW.object_name),
 'createdAt',CAST(strftime('%s','now') AS INTEGER)*1000,'expiresAt',json('null')),
 CAST(strftime('%s','now') AS INTEGER)*1000
WHERE EXISTS(SELECT 1 FROM notification_subscriptions WHERE workspace_id=NEW.tenant_id AND collection=NEW.object_name);
END;
--> statement-breakpoint
CREATE TRIGGER notification_record_purge AFTER DELETE ON "studio_records"
BEGIN
INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at)
SELECT 'ntf_'||lower(hex(randomblob(8))),'workspace',OLD.tenant_id,
 'record:'||OLD.tenant_id||':'||OLD.object_name||':'||OLD.id||':purged',
 json_object('scope',json_object('kind','workspace','id',OLD.tenant_id),'key','record:'||OLD.tenant_id||':'||OLD.object_name||':'||OLD.id||':purged',
 'actor',json_object('kind','system','id',NULL),
 'source',json_object('kind','record','collection',OLD.object_name,'id',OLD.id,'operation','deleted'),
 'title',OLD.object_name||' deleted','body','',
 'audience',json_object('kind','collection-followers','collection',OLD.object_name),
 'createdAt',CAST(strftime('%s','now') AS INTEGER)*1000,'expiresAt',json('null')),
 CAST(strftime('%s','now') AS INTEGER)*1000
WHERE EXISTS(SELECT 1 FROM notification_subscriptions WHERE workspace_id=OLD.tenant_id AND collection=OLD.object_name);
END;
--> statement-breakpoint
CREATE TRIGGER notification_event_fanout AFTER INSERT ON notification_events
BEGIN
INSERT OR IGNORE INTO notification_deliveries(id,event_id,scope_kind,scope_id,recipient_id,created_at)
SELECT 'dlv_'||NEW.id||'_'||s.principal_id,NEW.id,NEW.scope_kind,NEW.scope_id,s.principal_id,NEW.created_at
FROM notification_subscriptions s
WHERE s.workspace_id=NEW.scope_id
 AND s.collection=json_extract(NEW.payload,'$.audience.collection')
 AND json_extract(NEW.payload,'$.audience.kind')='collection-followers'
 AND (json_extract(NEW.payload,'$.actor.id') IS NULL OR s.principal_id<>json_extract(NEW.payload,'$.actor.id'));
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_links_cardinality BEFORE INSERT ON studio_record_links
BEGIN
 SELECT RAISE(ABORT,'relation_cardinality_conflict') WHERE EXISTS (
 SELECT 1 FROM studio_collection_relations r JOIN studio_record_links e ON e.tenant_id=r.tenant_id AND e.relation_id=r.id
 WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.relation_id
 AND ((r.cardinality='one-to-one' AND e.source_id=NEW.source_id AND e.target_id<>NEW.target_id)
 OR (r.cardinality IN ('one-to-one','one-to-many') AND e.target_id=NEW.target_id AND e.source_id<>NEW.source_id))
 );
END;
--> statement-breakpoint
CREATE TRIGGER studio_relation_definition_update BEFORE UPDATE ON studio_collection_relations
BEGIN
 SELECT RAISE(ABORT,'relation_mapping_has_links') WHERE (NEW.source_field<>OLD.source_field OR NEW.target_field<>OLD.target_field OR NEW.storage<>OLD.storage) AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id);
 SELECT RAISE(ABORT,'relation_cardinality_conflict') WHERE (NEW.cardinality='one-to-one' AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id GROUP BY source_id HAVING count(*)>1)) OR (NEW.cardinality IN ('one-to-one','one-to-many') AND EXISTS(SELECT 1 FROM studio_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id GROUP BY target_id HAVING count(*)>1));
END;
--> statement-breakpoint
CREATE TRIGGER studio_record_links_storage BEFORE INSERT ON studio_record_links
BEGIN
 SELECT RAISE(ABORT,'relation_mapping_has_links') WHERE EXISTS(SELECT 1 FROM studio_collection_relations WHERE tenant_id=NEW.tenant_id AND id=NEW.relation_id AND storage<>'local');
END;
--> statement-breakpoint
CREATE TRIGGER studio_history_insert AFTER INSERT ON studio_records
 BEGIN
 INSERT INTO studio_record_history(tenant_id,object_name,record_id,version,action,created_at,actor_kind,actor_id,cause_id,changes,expires_at)
 SELECT NEW.tenant_id,NEW.object_name,NEW.id,NEW.version,'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 COALESCE((SELECT actor_kind FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),'system'),
 (SELECT actor_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT cause_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT json_group_object(field_name,json(substr('{}',1,length('{}')-1)||IIF('{}'<>'{}' AND IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}')<>'{}',',','')||substr(IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}'),2))) FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))),
 strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||retention_days||' days')
 FROM studio_record_history_fields
 WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name
 AND ((1) OR EXISTS(SELECT 1 FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))))
 LIMIT 1;
 END;
--> statement-breakpoint
CREATE TRIGGER studio_history_update AFTER UPDATE ON studio_records
 BEGIN
 INSERT INTO studio_record_history(tenant_id,object_name,record_id,version,action,created_at,actor_kind,actor_id,cause_id,changes,expires_at)
 SELECT NEW.tenant_id,NEW.object_name,NEW.id,NEW.version,IIF(OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL,'deleted',IIF(OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL,'restored','updated')),strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 COALESCE((SELECT actor_kind FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),'system'),
 (SELECT actor_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT cause_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT json_group_object(field_name,json(substr(IIF(json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('before',IIF(json_type(OLD.data,'$.'||field_name)='text' AND NOT (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))<=2050),substr(json_extract(OLD.data,'$.'||field_name),1,2048),json((OLD.data -> ('$.'||field_name))))),IIF(json_type(OLD.data,'$.'||field_name)='text' AND (length(json_extract(OLD.data,'$.'||field_name))>2048 OR (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))>2050)),json_object('beforeTruncated',json('true')),'{}')),'{}'),1,length(IIF(json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('before',IIF(json_type(OLD.data,'$.'||field_name)='text' AND NOT (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))<=2050),substr(json_extract(OLD.data,'$.'||field_name),1,2048),json((OLD.data -> ('$.'||field_name))))),IIF(json_type(OLD.data,'$.'||field_name)='text' AND (length(json_extract(OLD.data,'$.'||field_name))>2048 OR (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))>2050)),json_object('beforeTruncated',json('true')),'{}')),'{}'))-1)||IIF(IIF(json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('before',IIF(json_type(OLD.data,'$.'||field_name)='text' AND NOT (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))<=2050),substr(json_extract(OLD.data,'$.'||field_name),1,2048),json((OLD.data -> ('$.'||field_name))))),IIF(json_type(OLD.data,'$.'||field_name)='text' AND (length(json_extract(OLD.data,'$.'||field_name))>2048 OR (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))>2050)),json_object('beforeTruncated',json('true')),'{}')),'{}')<>'{}' AND IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}')<>'{}',',','')||substr(IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}'),2))) FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (((IIF(json_type(OLD.data,'$.'||field_name) IN ('integer','real'),'number',json_type(OLD.data,'$.'||field_name)) IS NOT IIF(json_type(NEW.data,'$.'||field_name) IN ('integer','real'),'number',json_type(NEW.data,'$.'||field_name)) OR json_extract(OLD.data,'$.'||field_name) IS NOT json_extract(NEW.data,'$.'||field_name)) AND (json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false') OR json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))))),
 strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||retention_days||' days')
 FROM studio_record_history_fields
 WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name
 AND ((OLD.deleted_at IS NOT NEW.deleted_at) OR EXISTS(SELECT 1 FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (((IIF(json_type(OLD.data,'$.'||field_name) IN ('integer','real'),'number',json_type(OLD.data,'$.'||field_name)) IS NOT IIF(json_type(NEW.data,'$.'||field_name) IN ('integer','real'),'number',json_type(NEW.data,'$.'||field_name)) OR json_extract(OLD.data,'$.'||field_name) IS NOT json_extract(NEW.data,'$.'||field_name)) AND (json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false') OR json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))))))
 LIMIT 1;
 END;
--> statement-breakpoint
CREATE TRIGGER studio_history_delete AFTER DELETE ON studio_records BEGIN
 DELETE FROM studio_record_history WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name AND record_id=OLD.id;
END;
--> statement-breakpoint
DROP TABLE tenant_namespace_guard;
