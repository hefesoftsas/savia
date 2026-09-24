DELETE FROM crm_integration_runs;
DELETE FROM crm_integrations;
ALTER TABLE crm_integrations ADD COLUMN owner_principal_id TEXT NOT NULL DEFAULT '';
CREATE INDEX crm_integrations_owner_index ON crm_integrations(tenant_id, owner_principal_id);
