ALTER TABLE tenants ADD COLUMN kind TEXT NOT NULL DEFAULT 'commercial' CHECK(kind IN ('commercial','platform'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tenant_consolidation_sources (
 source_tenant_id INTEGER PRIMARY KEY,
 target_tenant_id INTEGER NOT NULL,
 consolidated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tenant_consolidation_discards (
 source_tenant_id INTEGER NOT NULL,
 target_tenant_id INTEGER NOT NULL,
 table_name TEXT NOT NULL,
 record_key TEXT NOT NULL,
 discarded_at TEXT NOT NULL,
 PRIMARY KEY(source_tenant_id,table_name,record_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tenant_consolidation_agency_bootstraps (
 target_tenant_id INTEGER PRIMARY KEY,
 source_tenant_id INTEGER NOT NULL,
 temporary_short_name TEXT NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind)
VALUES(0,'savia-platform','Plataforma Savia',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'platform');
--> statement-breakpoint
UPDATE identity_tenant_membership
SET tenant_id=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE principal_id IN (SELECT principal_id FROM identity_global_role WHERE role='platform_admin');
--> statement-breakpoint
INSERT OR IGNORE INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at)
SELECT 'platform:' || p.id,p.id,0,'tenant_admin',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM identity_principal p
JOIN identity_global_role r ON r.principal_id=p.id AND r.role='platform_admin'
WHERE NOT EXISTS(SELECT 1 FROM identity_tenant_membership m WHERE m.principal_id=p.id);
--> statement-breakpoint
INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at)
SELECT 'primary:' || p.id,p.id,(SELECT MIN(id) FROM tenants WHERE kind='commercial' AND is_active=1),'viewer',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM identity_principal p
WHERE NOT EXISTS(SELECT 1 FROM identity_global_role r WHERE r.principal_id=p.id AND r.role='platform_admin')
  AND NOT EXISTS(SELECT 1 FROM identity_tenant_membership m WHERE m.principal_id=p.id);
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_sources(source_tenant_id,target_tenant_id,consolidated_at)
SELECT t.id,(SELECT MIN(id) FROM tenants WHERE kind='commercial' AND is_active=1),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM tenants t
WHERE t.kind='commercial' AND t.is_active=1
  AND t.id<>(SELECT MIN(id) FROM tenants WHERE kind='commercial' AND is_active=1)
  AND NOT EXISTS(
    SELECT 1 FROM identity_tenant_membership m
    JOIN identity_principal p ON p.id=m.principal_id
    WHERE m.tenant_id=t.id AND m.is_active=1 AND p.is_active=1
  );
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_agency_bootstraps(target_tenant_id,source_tenant_id,temporary_short_name)
SELECT s.target_tenant_id,a.id,'consolidated-' || s.target_tenant_id
FROM agencies a
JOIN tenant_consolidation_sources s ON s.source_tenant_id=a.id
WHERE NOT EXISTS(SELECT 1 FROM agencies destination WHERE destination.id=s.target_tenant_id)
  AND a.id=(
    SELECT MIN(source.id)
    FROM agencies source
    JOIN tenant_consolidation_sources candidate ON candidate.source_tenant_id=source.id
    WHERE candidate.target_tenant_id=s.target_tenant_id
  );
--> statement-breakpoint
INSERT OR IGNORE INTO agencies(
 id,tenant_id,id_slug,created_at,updated_at,name,address,id_check_digit,id_number,phone,logo,city_id,coordinates,
 lr_id_number,lr_id_type,lr_name,payments_email,is_active,email,is_in_house,email_domain,birthday_from_email,
 payment_from_email,renewal_from_email,home_url,short_name,seller_required,has_compliance,default_cc_emails,
 surnames,type,theme,retirement_date
)
SELECT b.target_tenant_id,b.target_tenant_id,t.id_slug,a.created_at,a.updated_at,t.name,a.address,a.id_check_digit,
 a.id_number,a.phone,a.logo,a.city_id,a.coordinates,a.lr_id_number,a.lr_id_type,a.lr_name,a.payments_email,
 t.is_active,a.email,a.is_in_house,a.email_domain,a.birthday_from_email,a.payment_from_email,a.renewal_from_email,
 a.home_url,b.temporary_short_name,a.seller_required,a.has_compliance,a.default_cc_emails,a.surnames,a.type,a.theme,
 a.retirement_date
FROM tenant_consolidation_agency_bootstraps b
JOIN agencies a ON a.id=b.source_tenant_id
JOIN tenants t ON t.id=b.target_tenant_id;
--> statement-breakpoint
INSERT OR IGNORE INTO crm_objects(tenant_id,name,label,description,config,created_at,version)
SELECT 'agency:' || s.target_tenant_id,o.name,o.label,o.description,o.config,o.created_at,o.version
FROM crm_objects o
JOIN tenant_consolidation_sources s ON o.tenant_id='agency:' || s.source_tenant_id;
--> statement-breakpoint
INSERT OR IGNORE INTO crm_records(id,tenant_id,object_name,data,created_at,updated_at,version,deleted_at)
SELECT r.id,'agency:' || s.target_tenant_id,r.object_name,r.data,r.created_at,r.updated_at,r.version,r.deleted_at
FROM crm_records r
JOIN tenant_consolidation_sources s ON r.tenant_id='agency:' || s.source_tenant_id;
--> statement-breakpoint
UPDATE OR IGNORE crm_views SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_views.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_integrations SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_integrations.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_audit SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_audit.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_unique_values SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_unique_values.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_requests SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_requests.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_schema_versions SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_schema_versions.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_schema_data SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_schema_data.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_integration_runs SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_integration_runs.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_notes SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_notes.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_files SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_files.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_file_drafts SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_file_drafts.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_automations SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_automations.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_automation_runs SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_automation_runs.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_tasks SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_tasks.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_business_links SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_business_links.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_collection_sources SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_collection_sources.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_collection_bindings SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_collection_bindings.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_collection_requests SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_collection_requests.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_collection_relations SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_collection_relations.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_record_links SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_record_links.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_native_relation_overrides SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_native_relation_overrides.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
-- Copy parents before moving children; source parents are deleted after their objects.
INSERT OR IGNORE INTO crm_solution_installations(tenant_id,id,version,enabled,manifest,installed_at,updated_at)
SELECT 'agency:' || s.target_tenant_id,i.id,i.version,i.enabled,i.manifest,i.installed_at,i.updated_at
FROM crm_solution_installations i
JOIN tenant_consolidation_sources s ON i.tenant_id='agency:' || s.source_tenant_id;
--> statement-breakpoint
UPDATE OR IGNORE crm_solution_objects SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_solution_objects.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_extension_installations SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_extension_installations.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_geocoding_settings SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_geocoding_settings.tenant_id='agency:' || s.source_tenant_id) WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE crm_sync_rules SET tenant_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_sync_rules.tenant_id=s.source_tenant_id) WHERE tenant_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_sync_mappings WHERE rule_id IN (SELECT r.id FROM crm_sync_rules r JOIN tenant_consolidation_sources s ON r.tenant_id=s.source_tenant_id);
--> statement-breakpoint
DELETE FROM crm_sync_jobs WHERE rule_id IN (SELECT r.id FROM crm_sync_rules r JOIN tenant_consolidation_sources s ON r.tenant_id=s.source_tenant_id);
--> statement-breakpoint
DELETE FROM crm_sync_rules WHERE tenant_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_views WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_integrations WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_audit WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_unique_values WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_requests WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_schema_versions WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_schema_data WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_integration_runs WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_notes WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_files WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_file_drafts WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_automations WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_automation_runs WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_tasks WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_business_links WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_collection_sources WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_collection_bindings WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_collection_requests WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_record_links WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_collection_relations WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_native_relation_overrides WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_solution_objects WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_solution_installations WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_extension_installations WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_geocoding_settings WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_records WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_objects WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_discards(source_tenant_id,target_tenant_id,table_name,record_key,discarded_at)
SELECT s.source_tenant_id,s.target_tenant_id,'crm_studio_settings',source.tenant_id,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM crm_studio_settings source
JOIN tenant_consolidation_sources s ON source.tenant_id='agency:' || s.source_tenant_id
WHERE EXISTS(SELECT 1 FROM crm_studio_settings destination WHERE destination.tenant_id='agency:' || s.target_tenant_id);
--> statement-breakpoint
UPDATE OR IGNORE crm_studio_settings
SET tenant_id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE crm_studio_settings.tenant_id='agency:' || s.source_tenant_id)
WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM crm_studio_settings
WHERE tenant_id IN (SELECT 'agency:' || source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
-- Ownership rows retain their document keys while moving to the destination agency.
UPDATE document_ownership
SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE document_ownership.agency_id=s.source_tenant_id)
WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
-- Every legacy agency-scoped row is moved before its source agency is removed.
-- A uniqueness collision leaves the source row in place; it is audited below and
-- discarded because the destination tenant wins by policy.
UPDATE OR IGNORE app_documenttag SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE app_documenttag.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE agency_contacts SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE agency_contacts.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE agency_branches SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE agency_branches.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE attachment_uploads SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE attachment_uploads.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE auto_light_quote_requests SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE auto_light_quote_requests.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_agency_renewal_task_managers SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_agency_renewal_task_managers.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_agencycomplementarydata SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_agencycomplementarydata.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_agencycompliancemailbox SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_agencycompliancemailbox.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_allianzconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_allianzconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_axaconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_axaconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_bolivarconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_bolivarconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_chubbconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_chubbconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_commercialunit SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_commercialunit.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_defaultcommission SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_defaultcommission.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_equidadconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_equidadconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_hdiconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_hdiconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_mapfreconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_mapfreconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_previsoraconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_previsoraconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_qualitasconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_qualitasconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_renewalconfiguration SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_renewalconfiguration.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_sbsconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_sbsconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_seller SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_seller.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_solidariaconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_solidariaconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_suraconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_suraconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE business_zurichconnectionkey SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE business_zurichconnectionkey.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE compliance_complianceprogramtype SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE compliance_complianceprogramtype.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE compliance_compliancerequest SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE compliance_compliancerequest.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE compliance_compliancetag SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE compliance_compliancetag.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE compliance_processstepemailtemplate SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE compliance_processstepemailtemplate.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE customer_clientagency SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE customer_clientagency.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE customer_crm_sync_records SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE customer_crm_sync_records.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE customer_group SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE customer_group.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE customer_prospect SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE customer_prospect.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE financial_statements_accountnormalization SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE financial_statements_accountnormalization.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE financial_statements_agencyauthentication SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE financial_statements_agencyauthentication.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE financial_statements_financialreportfile SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE financial_statements_financialreportfile.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE financial_statements_financialreportrequest_agencies SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE financial_statements_financialreportrequest_agencies.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE financial_statements_financialstatement SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE financial_statements_financialstatement.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE help_request SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE help_request.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE insurance_agencyshare SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE insurance_agencyshare.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE notification_configuration SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE notification_configuration.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE notification_emailtemplate SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE notification_emailtemplate.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE notification_externalnotification SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE notification_externalnotification.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE operation_collectionfile SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE operation_collectionfile.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE operation_payment SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE operation_payment.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE operation_portfolioreconciliationfile SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE operation_portfolioreconciliationfile.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE operation_reconciliationfile SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE operation_reconciliationfile.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE operation_reimbursementreport SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE operation_reimbursementreport.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE operation_task SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE operation_task.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE operation_taskassignmentrule SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE operation_taskassignmentrule.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE operation_tasktag SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE operation_tasktag.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE production_data_importproductiondatafile SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE production_data_importproductiondatafile.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE production_data_standardizeinsurer SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE production_data_standardizeinsurer.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE production_data_standardizeramo SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE production_data_standardizeramo.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE renewal_initialstepconfig SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE renewal_initialstepconfig.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE user_user SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE user_user.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE agency_crm_connections SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE agency_crm_connections.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE agency_crm_connection_audit_events SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE agency_crm_connection_audit_events.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE assistant_active_agencies SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE assistant_active_agencies.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE assistant_openrouter_settings SET id='agency:' || (SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE assistant_openrouter_settings.agency_id=s.source_tenant_id),agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE assistant_openrouter_settings.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
UPDATE OR IGNORE assistant_virtual_employees SET agency_id=(SELECT target_tenant_id FROM tenant_consolidation_sources s WHERE assistant_virtual_employees.agency_id=s.source_tenant_id) WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_discards(source_tenant_id,target_tenant_id,table_name,record_key,discarded_at)
SELECT s.source_tenant_id,s.target_tenant_id,'app_documenttag',CAST(r.id AS TEXT),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM app_documenttag r JOIN tenant_consolidation_sources s ON r.agency_id=s.source_tenant_id;
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_discards(source_tenant_id,target_tenant_id,table_name,record_key,discarded_at)
SELECT s.source_tenant_id,s.target_tenant_id,'agency_contacts',CAST(r.id AS TEXT),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM agency_contacts r JOIN tenant_consolidation_sources s ON r.agency_id=s.source_tenant_id;
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_discards(source_tenant_id,target_tenant_id,table_name,record_key,discarded_at)
SELECT s.source_tenant_id,s.target_tenant_id,'agency_branches',CAST(r.id AS TEXT),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM agency_branches r JOIN tenant_consolidation_sources s ON r.agency_id=s.source_tenant_id;
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_discards(source_tenant_id,target_tenant_id,table_name,record_key,discarded_at)
SELECT s.source_tenant_id,s.target_tenant_id,'attachment_uploads',r.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM attachment_uploads r JOIN tenant_consolidation_sources s ON r.agency_id=s.source_tenant_id;
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_discards(source_tenant_id,target_tenant_id,table_name,record_key,discarded_at)
SELECT s.source_tenant_id,s.target_tenant_id,'auto_light_quote_requests',r.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM auto_light_quote_requests r JOIN tenant_consolidation_sources s ON r.agency_id=s.source_tenant_id;
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_discards(source_tenant_id,target_tenant_id,table_name,record_key,discarded_at)
SELECT s.source_tenant_id,s.target_tenant_id,'customer_crm_sync_records',r.principal_id || ':' || r.customer_profile_id || ':' || r.provider || ':' || r.object_kind,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM customer_crm_sync_records r JOIN tenant_consolidation_sources s ON r.agency_id=s.source_tenant_id;
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_discards(source_tenant_id,target_tenant_id,table_name,record_key,discarded_at)
SELECT s.source_tenant_id,s.target_tenant_id,'assistant_active_agencies',r.principal_id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM assistant_active_agencies r JOIN tenant_consolidation_sources s ON r.agency_id=s.source_tenant_id;
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_discards(source_tenant_id,target_tenant_id,table_name,record_key,discarded_at)
SELECT s.source_tenant_id,s.target_tenant_id,'assistant_openrouter_settings',r.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM assistant_openrouter_settings r JOIN tenant_consolidation_sources s ON r.agency_id=s.source_tenant_id;
--> statement-breakpoint
INSERT OR IGNORE INTO tenant_consolidation_discards(source_tenant_id,target_tenant_id,table_name,record_key,discarded_at)
SELECT s.source_tenant_id,s.target_tenant_id,'assistant_virtual_employees',r.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM assistant_virtual_employees r JOIN tenant_consolidation_sources s ON r.agency_id=s.source_tenant_id;
--> statement-breakpoint
DELETE FROM app_documenttag WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM agency_contacts WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM agency_branches WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM attachment_uploads WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM auto_light_quote_requests WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_agency_renewal_task_managers WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_agencycomplementarydata WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_agencycompliancemailbox WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_allianzconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_axaconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_bolivarconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_chubbconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_commercialunit WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_defaultcommission WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_equidadconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_hdiconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_mapfreconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_previsoraconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_qualitasconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_renewalconfiguration WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_sbsconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_seller WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_solidariaconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_suraconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM business_zurichconnectionkey WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM compliance_complianceprogramtype WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM compliance_compliancerequest WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM compliance_compliancetag WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM compliance_processstepemailtemplate WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM customer_clientagency WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM customer_crm_sync_records WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM customer_group WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM customer_prospect WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM financial_statements_accountnormalization WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM financial_statements_agencyauthentication WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM financial_statements_financialreportfile WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM financial_statements_financialreportrequest_agencies WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM financial_statements_financialstatement WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM help_request WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM insurance_agencyshare WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM notification_configuration WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM notification_emailtemplate WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM notification_externalnotification WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM operation_collectionfile WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM operation_payment WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM operation_portfolioreconciliationfile WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM operation_reconciliationfile WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM operation_reimbursementreport WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM operation_task WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM operation_taskassignmentrule WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM operation_tasktag WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM production_data_importproductiondatafile WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM production_data_standardizeinsurer WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM production_data_standardizeramo WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM renewal_initialstepconfig WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM user_user WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM agency_crm_connections WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM agency_crm_connection_audit_events WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM assistant_active_agencies WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM assistant_openrouter_settings WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM assistant_virtual_employees WHERE agency_id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM agencies
WHERE id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
--> statement-breakpoint
DELETE FROM tenants
WHERE id IN (SELECT source_tenant_id FROM tenant_consolidation_sources);
