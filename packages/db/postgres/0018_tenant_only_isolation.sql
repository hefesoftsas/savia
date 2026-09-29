-- Tenant-only isolation. Apply in one transaction; guard failures require explicit conflict resolution.
-- Historical mapping is migration provenance, never a runtime workspace catalog.
CREATE TABLE IF NOT EXISTS tenant_namespace_migrations (old_key TEXT PRIMARY KEY, tenant_id BIGINT NOT NULL);

INSERT INTO tenant_namespace_migrations(old_key,tenant_id) SELECT 'domain:platform',0 WHERE EXISTS(SELECT 1 FROM tenants WHERE id=0) ON CONFLICT(old_key) DO NOTHING;

INSERT INTO tenant_namespace_migrations(old_key,tenant_id) SELECT 'agency:'||id,id FROM tenants WHERE 1=1 ON CONFLICT(old_key) DO NOTHING;

INSERT INTO tenant_namespace_migrations(old_key,tenant_id) SELECT 'domain:'||d.id, (SELECT COALESCE(MAX(id),0) FROM tenants)+ROW_NUMBER() OVER(ORDER BY d.id) FROM studio_data_domains d WHERE NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key='domain:'||d.id);

CREATE TABLE tenant_namespace_guard (collision INTEGER CONSTRAINT tenant_namespace_collision CHECK(collision=0), membership INTEGER CONSTRAINT tenant_membership_conflict CHECK(membership=0), unmapped INTEGER CONSTRAINT tenant_namespace_unmapped CHECK(unmapped=0));

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_namespace_migrations WHERE (old_key='domain:platform' AND tenant_id<>0) OR (old_key LIKE 'agency:%' AND old_key<>'agency:'||tenant_id) OR tenant_id<0) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(membership) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_assignments a JOIN tenant_namespace_migrations m ON m.old_key=a.scope WHERE a.scope LIKE 'domain:%' AND NOT EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=a.principal_id AND g.role='platform_admin') AND NOT EXISTS(SELECT 1 FROM identity_tenant_membership i WHERE i.principal_id=a.principal_id AND i.tenant_id=m.tenant_id AND i.is_active=1)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_objects s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_objects s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."name" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_records s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_records s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_views s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_integrations s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_audit s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_unique_values s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_unique_values s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."field_name",s."value" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_requests s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_requests s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."request_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_schema_versions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_schema_versions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."version" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_schema_data s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_schema_data s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."version",s."record_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_integration_runs s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_integration_runs s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."integration_id",s."operation_id",s."idempotency_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_notes s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_files s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_automations s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_automation_runs s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_automation_runs s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."automation_id",s."event_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_tasks s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_business_links s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_business_links s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."record_id",s."connection_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM managed_customer_extensions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM managed_customer_extensions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."profile_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM managed_customer_requests s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM managed_customer_requests s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."request_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_collection_bindings s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_collection_bindings s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_requests s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_requests s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."request_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_relations s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_relations s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_links s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_links s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."relation_id",s."source_id",s."target_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_native_relation_overrides s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_native_relation_overrides s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_file_drafts s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_settings s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_settings s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id) HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_solution_installations s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_solution_installations s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_solution_objects s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_solution_objects s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_geocoding_settings s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_geocoding_settings s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id) HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_extension_installations s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_extension_installations s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_connections s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_connections s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."extension_id",s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_connection_audit_events s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_action_runs s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_action_runs s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."run_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_settings s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM extension_settings s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."extension_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_versions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_versions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."collection" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_sync_changes s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_sync_changes s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_sync_receipts s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM crm_sync_receipts s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."principal_id",s."mutation_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM public_forms s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM public_form_submissions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflows s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflows s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_versions s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_versions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_versions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."workflow_id",s."revision" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_events s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_executions s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_executions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_executions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."workflow_id",s."event_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_jobs s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_jobs s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."execution_id",s."node_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_tasks s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_tasks s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."execution_id",s."node_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_tasks s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_write_context s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_write_context s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."record_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_roles s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_roles s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_roles s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s."name" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_grants s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_assignments s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_assignments s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s."principal_id",s."role_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_audit s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_sources s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_collection_sources s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."owner_principal_id",s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_file_revisions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_file_revisions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."file_id",s."version" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_access_deliveries s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_access_deliveries s GROUP BY s."principal_id",COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s."revision",s."object_name",s."record_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_history s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_history s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."object_name",s."record_id",s."version" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_history_context s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_record_history_context s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id) HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_endpoints s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_endpoints s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_endpoints s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."workflow_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_receipts s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_receipts s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."endpoint_id",s."event_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_destinations s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_destinations s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_destination_versions s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_destination_versions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."id",s."revision" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_deliveries s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_deliveries s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."execution_id",s."node_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_attempts s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM workflow_webhook_attempts s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."execution_id",s."node_id",s."sequence" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_subscriptions s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_subscriptions s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."principal_id",s."collection" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_admin_audit s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_send_limits s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_send_limits s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id),s."actor_id",s."window_start" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_scope_settings s WHERE (s.workspace_id LIKE 'domain:%' OR s.workspace_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_scope_settings s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.workspace_id),s.workspace_id) HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flows s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flows s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."flow_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flow_variables s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flow_variables s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."flow_id",s."key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flow_versions s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_flow_runs s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_folders s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_folders s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."path" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_bundles s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM tenant_bundles s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM bundle_flow_state s WHERE (s.scope LIKE 'domain:%' OR s.scope LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM bundle_flow_state s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s."flow_id" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM savia_request_audit s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM plugin_store_artifacts s WHERE (s.tenant_id LIKE 'domain:%' OR s.tenant_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM plugin_store_artifacts s GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s."id",s."version" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_events s WHERE s.scope_kind='workspace' AND (s.scope_id LIKE 'domain:%' OR s.scope_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_events s GROUP BY s."scope_kind",CASE WHEN s.scope_kind='workspace' THEN COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope_id),s.scope_id) ELSE s.scope_id END,s."event_key" HAVING COUNT(*)>1) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM notification_deliveries s WHERE s.scope_kind='workspace' AND (s.scope_id LIKE 'domain:%' OR s.scope_id LIKE 'agency:%') AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id)) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(collision) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_roles r JOIN tenant_namespace_migrations m ON m.old_key=r.scope WHERE NOT EXISTS(SELECT 1 FROM tenants t WHERE t.id=m.tenant_id) AND r.name IN ('tenant_admin','agency_admin','operator','viewer')) THEN 1 ELSE 0 END;

INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) SELECT m.tenant_id,'workspace-'||m.tenant_id,d.label,1,to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'commercial' FROM studio_data_domains d JOIN tenant_namespace_migrations m ON m.old_key='domain:'||d.id WHERE NOT EXISTS(SELECT 1 FROM tenants t WHERE t.id=m.tenant_id);

INSERT INTO tenant_namespace_guard(membership) SELECT CASE WHEN EXISTS(SELECT 1 FROM access_assignments a WHERE a.scope='platform' AND NOT EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=a.principal_id AND g.role='platform_admin')) THEN 1 ELSE 0 END;

INSERT INTO tenant_namespace_guard(unmapped) SELECT CASE WHEN EXISTS(SELECT 1 FROM request_page_runs r WHERE r.domain_id NOT LIKE 'tenant:%' AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=r.domain_id OR m.old_key='domain:'||r.domain_id)) THEN 1 ELSE 0 END;

CREATE TEMP TABLE tenant_namespace_fk_state ON COMMIT DROP AS SELECT conrelid::regclass AS tbl,conname,condeferrable,condeferred FROM pg_constraint WHERE contype='f' AND connamespace=current_schema()::regnamespace;

DO $$ DECLARE c record; BEGIN FOR c IN SELECT conrelid::regclass AS tbl,conname FROM pg_constraint WHERE contype='f' AND connamespace=current_schema()::regnamespace LOOP EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED',c.tbl,c.conname); END LOOP; END $$;

CREATE TEMP TABLE tenant_namespace_trigger_state ON COMMIT DROP AS SELECT tgrelid::regclass AS tbl,tgname,tgenabled FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace=current_schema()::regnamespace);

ALTER TABLE studio_objects DISABLE TRIGGER USER;

ALTER TABLE studio_records DISABLE TRIGGER USER;

ALTER TABLE studio_views DISABLE TRIGGER USER;

ALTER TABLE studio_integrations DISABLE TRIGGER USER;

ALTER TABLE studio_audit DISABLE TRIGGER USER;

ALTER TABLE studio_unique_values DISABLE TRIGGER USER;

ALTER TABLE studio_requests DISABLE TRIGGER USER;

ALTER TABLE studio_schema_versions DISABLE TRIGGER USER;

ALTER TABLE studio_schema_data DISABLE TRIGGER USER;

ALTER TABLE studio_integration_runs DISABLE TRIGGER USER;

ALTER TABLE studio_notes DISABLE TRIGGER USER;

ALTER TABLE studio_files DISABLE TRIGGER USER;

ALTER TABLE studio_automations DISABLE TRIGGER USER;

ALTER TABLE studio_automation_runs DISABLE TRIGGER USER;

ALTER TABLE studio_tasks DISABLE TRIGGER USER;

ALTER TABLE studio_business_links DISABLE TRIGGER USER;

ALTER TABLE managed_customer_extensions DISABLE TRIGGER USER;

ALTER TABLE managed_customer_requests DISABLE TRIGGER USER;

ALTER TABLE crm_collection_bindings DISABLE TRIGGER USER;

ALTER TABLE studio_collection_requests DISABLE TRIGGER USER;

ALTER TABLE studio_collection_relations DISABLE TRIGGER USER;

ALTER TABLE studio_record_links DISABLE TRIGGER USER;

ALTER TABLE studio_native_relation_overrides DISABLE TRIGGER USER;

ALTER TABLE studio_file_drafts DISABLE TRIGGER USER;

ALTER TABLE studio_settings DISABLE TRIGGER USER;

ALTER TABLE studio_solution_installations DISABLE TRIGGER USER;

ALTER TABLE studio_solution_objects DISABLE TRIGGER USER;

ALTER TABLE studio_geocoding_settings DISABLE TRIGGER USER;

ALTER TABLE studio_extension_installations DISABLE TRIGGER USER;

ALTER TABLE extension_connections DISABLE TRIGGER USER;

ALTER TABLE extension_connection_audit_events DISABLE TRIGGER USER;

ALTER TABLE extension_action_runs DISABLE TRIGGER USER;

ALTER TABLE extension_settings DISABLE TRIGGER USER;

ALTER TABLE studio_collection_versions DISABLE TRIGGER USER;

ALTER TABLE crm_sync_changes DISABLE TRIGGER USER;

ALTER TABLE crm_sync_receipts DISABLE TRIGGER USER;

ALTER TABLE public_forms DISABLE TRIGGER USER;

ALTER TABLE public_form_submissions DISABLE TRIGGER USER;

ALTER TABLE workflows DISABLE TRIGGER USER;

ALTER TABLE workflow_versions DISABLE TRIGGER USER;

ALTER TABLE workflow_events DISABLE TRIGGER USER;

ALTER TABLE workflow_executions DISABLE TRIGGER USER;

ALTER TABLE workflow_jobs DISABLE TRIGGER USER;

ALTER TABLE workflow_tasks DISABLE TRIGGER USER;

ALTER TABLE workflow_write_context DISABLE TRIGGER USER;

ALTER TABLE access_revisions DISABLE TRIGGER USER;

ALTER TABLE access_roles DISABLE TRIGGER USER;

ALTER TABLE access_grants DISABLE TRIGGER USER;

ALTER TABLE access_assignments DISABLE TRIGGER USER;

ALTER TABLE access_audit DISABLE TRIGGER USER;

ALTER TABLE studio_collection_sources DISABLE TRIGGER USER;

ALTER TABLE studio_file_revisions DISABLE TRIGGER USER;

ALTER TABLE studio_access_deliveries DISABLE TRIGGER USER;

ALTER TABLE studio_record_history DISABLE TRIGGER USER;

ALTER TABLE studio_record_history_context DISABLE TRIGGER USER;

ALTER TABLE workflow_webhook_endpoints DISABLE TRIGGER USER;

ALTER TABLE workflow_webhook_receipts DISABLE TRIGGER USER;

ALTER TABLE workflow_webhook_destinations DISABLE TRIGGER USER;

ALTER TABLE workflow_webhook_destination_versions DISABLE TRIGGER USER;

ALTER TABLE workflow_webhook_deliveries DISABLE TRIGGER USER;

ALTER TABLE workflow_webhook_attempts DISABLE TRIGGER USER;

ALTER TABLE notification_subscriptions DISABLE TRIGGER USER;

ALTER TABLE notification_admin_audit DISABLE TRIGGER USER;

ALTER TABLE notification_send_limits DISABLE TRIGGER USER;

ALTER TABLE notification_scope_settings DISABLE TRIGGER USER;

ALTER TABLE tenant_flows DISABLE TRIGGER USER;

ALTER TABLE tenant_flow_variables DISABLE TRIGGER USER;

ALTER TABLE tenant_flow_versions DISABLE TRIGGER USER;

ALTER TABLE tenant_flow_runs DISABLE TRIGGER USER;

ALTER TABLE tenant_folders DISABLE TRIGGER USER;

ALTER TABLE tenant_bundles DISABLE TRIGGER USER;

ALTER TABLE bundle_flow_state DISABLE TRIGGER USER;

ALTER TABLE savia_request_audit DISABLE TRIGGER USER;

ALTER TABLE plugin_store_artifacts DISABLE TRIGGER USER;

ALTER TABLE notification_events DISABLE TRIGGER USER;

ALTER TABLE notification_deliveries DISABLE TRIGGER USER;

UPDATE studio_integrations AS s SET encrypted_secret=(SELECT json_build_object('version',2,'context','tenant:'||m.tenant_id||':'||s.owner_principal_id||':'||s.id,'aad',s.tenant_id||':'||s.owner_principal_id||':'||s.id,'value',s.encrypted_secret)::text FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE encrypted_secret IS NOT NULL AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_collection_sources AS s SET encrypted_secret=(SELECT json_build_object('version',2,'context','['||to_json(('tenant:'||m.tenant_id))::text||','||to_json(s.owner_principal_id)::text||']:collection-source:'||s.id,'aad','['||to_json(s.tenant_id)::text||','||to_json(s.owner_principal_id)::text||']:collection-source:'||s.id,'value',s.encrypted_secret)::text FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE encrypted_secret IS NOT NULL AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_geocoding_settings AS s SET encrypted_geoapify_key=(SELECT json_build_object('version',2,'context','tenant:'||m.tenant_id||':geocoding','aad',s.tenant_id||':geocoding','value',s.encrypted_geoapify_key)::text FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE encrypted_geoapify_key IS NOT NULL AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE workflow_webhook_destinations AS s SET encrypted_secret=(SELECT json_build_object('version',2,'context','workflow-webhook:tenant:'||m.tenant_id||':'||s.id,'aad','workflow-webhook:'||s.workspace_id||':'||s.id,'value',s.encrypted_secret)::text FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE encrypted_secret IS NOT NULL AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE extension_connections AS s SET credential_ciphertext=(SELECT json_build_object('version',2,'context','savia/extensions/connection/v1/tenant:'||m.tenant_id||'/'||s.extension_id||'/'||s.id||'/'||s.connector_id,'aad','savia/extensions/connection/v1/'||s.tenant_id||'/'||s.extension_id||'/'||s.id||'/'||s.connector_id,'value',s.credential_ciphertext)::text FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE credential_ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

INSERT INTO access_revisions(scope,revision) SELECT 'tenant:'||m.tenant_id,MAX(r.revision)+1 FROM access_revisions r JOIN tenant_namespace_migrations m ON m.old_key=r.scope GROUP BY m.tenant_id HAVING 1=1 ON CONFLICT(scope) DO UPDATE SET revision=GREATEST(access_revisions.revision,excluded.revision);

INSERT INTO access_revisions(scope,revision) SELECT 'tenant:0',1 WHERE EXISTS(SELECT 1 FROM tenants WHERE id=0) ON CONFLICT(scope) DO NOTHING;

UPDATE studio_objects AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_records AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_views AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_integrations AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_audit AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_unique_values AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_requests AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_schema_versions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_schema_data AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_integration_runs AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_notes AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_files AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_automations AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_automation_runs AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_tasks AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_business_links AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE managed_customer_extensions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE managed_customer_requests AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE crm_collection_bindings AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_collection_requests AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_collection_relations AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_record_links AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_native_relation_overrides AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_file_drafts AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_settings AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_solution_installations AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_solution_objects AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_geocoding_settings AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_extension_installations AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE extension_connections AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE extension_connection_audit_events AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE extension_action_runs AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE extension_settings AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_collection_versions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE crm_sync_changes AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE crm_sync_receipts AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE public_forms AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE public_form_submissions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE workflows AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_versions AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_events AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_executions AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_jobs AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_tasks AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_write_context AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE access_roles AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);

UPDATE access_grants AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);

UPDATE access_assignments AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);

UPDATE access_audit AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);

UPDATE studio_collection_sources AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_file_revisions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_access_deliveries AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);

UPDATE studio_record_history AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE studio_record_history_context AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE workflow_webhook_endpoints AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_webhook_receipts AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_webhook_destinations AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_webhook_destination_versions AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_webhook_deliveries AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE workflow_webhook_attempts AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE notification_subscriptions AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE notification_admin_audit AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE notification_send_limits AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE notification_scope_settings AS s SET workspace_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.workspace_id);

UPDATE tenant_flows AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE tenant_flow_variables AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE tenant_flow_versions AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE tenant_flow_runs AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE tenant_folders AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE tenant_bundles AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE bundle_flow_state AS s SET scope=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope);

UPDATE savia_request_audit AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE plugin_store_artifacts AS s SET tenant_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id) WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id);

UPDATE notification_events AS s SET scope_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id) WHERE s.scope_kind='workspace' AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id);

UPDATE notification_deliveries AS s SET scope_id=(SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id) WHERE s.scope_kind='workspace' AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.scope_id);

UPDATE notification_events AS s SET payload=(SELECT jsonb_set(s.payload::jsonb,'{scope,id}',to_jsonb(('tenant:'||m.tenant_id)::text))::text FROM tenant_namespace_migrations m WHERE m.old_key=s.payload::jsonb #>> '{scope,id}') WHERE s.scope_kind='workspace' AND EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.payload::jsonb #>> '{scope,id}');

DELETE FROM access_revisions WHERE scope IN (SELECT old_key FROM tenant_namespace_migrations);

ALTER TABLE public_forms DROP COLUMN domain_id;

ALTER TABLE request_page_runs RENAME COLUMN domain_id TO tenant_id;

UPDATE request_page_runs AS s SET tenant_id=COALESCE((SELECT 'tenant:'||m.tenant_id FROM tenant_namespace_migrations m WHERE m.old_key=CASE WHEN s.tenant_id LIKE 'agency:%' OR s.tenant_id LIKE 'domain:%' THEN s.tenant_id ELSE 'domain:'||s.tenant_id END),s.tenant_id);

WITH RECURSIVE replacements(pos,old_path,new_path,old_page,new_page) AS (SELECT ROW_NUMBER() OVER(ORDER BY old_key),CASE WHEN old_key LIKE 'domain:%' THEN '/v1/data-domains/'||substr(old_key,8) ELSE '/v1/dynamic-crm/'||tenant_id END,'/v1/studio/'||tenant_id,CASE WHEN old_key LIKE 'domain:%' THEN substr(old_key,8) ELSE 'tenant%3A'||tenant_id END,CAST(tenant_id AS TEXT) FROM tenant_namespace_migrations), rewritten(principal_id,pos,value) AS (SELECT principal_id,0,layout FROM user_my_day_widgets UNION ALL SELECT r.principal_id,r.pos+1,replace(replace(replace(r.value,'"'||p.old_path||'"','"'||p.new_path||'"'),'"page:'||p.old_page||':','"page:'||p.new_page||':'),'"page:agency%3A'||p.new_page||':','"page:'||p.new_page||':') FROM rewritten r JOIN replacements p ON p.pos=r.pos+1) UPDATE user_my_day_widgets SET layout=(SELECT value FROM rewritten r WHERE r.principal_id=user_my_day_widgets.principal_id ORDER BY pos DESC LIMIT 1);

WITH RECURSIVE replacements(pos,old_path,new_path,old_page,new_page) AS (SELECT ROW_NUMBER() OVER(ORDER BY old_key),CASE WHEN old_key LIKE 'domain:%' THEN '/v1/data-domains/'||substr(old_key,8) ELSE '/v1/dynamic-crm/'||tenant_id END,'/v1/studio/'||tenant_id,CASE WHEN old_key LIKE 'domain:%' THEN substr(old_key,8) ELSE 'tenant%3A'||tenant_id END,CAST(tenant_id AS TEXT) FROM tenant_namespace_migrations), rewritten(principal_id,pos,value) AS (SELECT principal_id,0,layout FROM user_navigation_preferences UNION ALL SELECT r.principal_id,r.pos+1,replace(replace(replace(r.value,'"'||p.old_path||'"','"'||p.new_path||'"'),'"page:'||p.old_page||':','"page:'||p.new_page||':'),'"page:agency%3A'||p.new_page||':','"page:'||p.new_page||':') FROM rewritten r JOIN replacements p ON p.pos=r.pos+1) UPDATE user_navigation_preferences SET layout=(SELECT value FROM rewritten r WHERE r.principal_id=user_navigation_preferences.principal_id ORDER BY pos DESC LIMIT 1);

DROP TABLE studio_data_domains;

DROP FUNCTION IF EXISTS access_domain_created_fn();

DROP FUNCTION IF EXISTS access_domain_removed_fn();

CREATE OR REPLACE FUNCTION access_object_changed_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE access_revisions SET revision=revision+1 WHERE scope=NEW.tenant_id; RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION access_object_removed_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE access_revisions SET revision=revision+1 WHERE scope=OLD.tenant_id; RETURN OLD; END $$;

SET CONSTRAINTS ALL IMMEDIATE;

DO $$ DECLARE t record; BEGIN FOR t IN SELECT s.* FROM tenant_namespace_trigger_state s JOIN pg_trigger g ON g.tgrelid=s.tbl AND g.tgname=s.tgname LOOP EXECUTE format('ALTER TABLE %s %s TRIGGER %I',t.tbl,CASE t.tgenabled WHEN 'D' THEN 'DISABLE' WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'ENABLE' END,t.tgname); END LOOP; END $$;

DO $$ DECLARE c record; BEGIN FOR c IN SELECT * FROM tenant_namespace_fk_state LOOP EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I %s',c.tbl,c.conname,CASE WHEN c.condeferrable THEN CASE WHEN c.condeferred THEN 'DEFERRABLE INITIALLY DEFERRED' ELSE 'DEFERRABLE INITIALLY IMMEDIATE' END ELSE 'NOT DEFERRABLE' END); END LOOP; END $$;

SELECT setval(pg_get_serial_sequence('tenants','id'),GREATEST((SELECT COALESCE(MAX(id),1) FROM tenants),1),true);

DROP TABLE tenant_namespace_guard;
