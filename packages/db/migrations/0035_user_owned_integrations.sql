-- Existing CRM connections belong exclusively to their recorded creator.
DROP INDEX agency_crm_connections_active_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX agency_crm_connections_active_unique
  ON agency_crm_connections (created_by_principal_id, agency_id, provider)
  WHERE disconnected_at IS NULL;
--> statement-breakpoint
-- Historical mappings had no reliable user attribution; discard test mappings.
DROP TABLE customer_crm_sync_records;
--> statement-breakpoint
CREATE TABLE customer_crm_sync_records (
 principal_id TEXT NOT NULL REFERENCES identity_principal(id),
 agency_id BIGINT NOT NULL REFERENCES agencies(id),
 customer_profile_id BIGINT NOT NULL REFERENCES customer_clientagency(id),
 provider TEXT NOT NULL CHECK(provider IN ('hubspot','salesforce','zoho','pipedrive')),
 object_kind TEXT NOT NULL CHECK(object_kind IN ('contact','company')),
 external_object_id TEXT NOT NULL,
 last_synced_at TEXT, last_failure_code TEXT, last_failure_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(principal_id, agency_id, customer_profile_id, provider, object_kind)
);
--> statement-breakpoint
CREATE INDEX customer_crm_sync_records_customer_provider_index ON customer_crm_sync_records(customer_profile_id, provider);
--> statement-breakpoint
-- Dynamic connection rows did not record an owner. Remove their credentials and
-- run responses instead of assigning potentially private data to an arbitrary user.
DELETE FROM crm_integration_runs;
--> statement-breakpoint
DELETE FROM crm_integrations;
--> statement-breakpoint
ALTER TABLE crm_integrations ADD COLUMN owner_principal_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX crm_integrations_owner_index ON crm_integrations(tenant_id, owner_principal_id);
--> statement-breakpoint
-- JSON:API collection connections were also shared. Preserve collection metadata
-- and bindings, but require each user to configure their own source alias.
DROP TABLE crm_collection_sources;
--> statement-breakpoint
CREATE TABLE crm_collection_sources (
 tenant_id TEXT NOT NULL,
 owner_principal_id TEXT NOT NULL,
 id TEXT NOT NULL,
 label TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind='jsonapi'),
 config TEXT NOT NULL CHECK(json_valid(config)),
 encrypted_secret TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(tenant_id,owner_principal_id,id)
);
--> statement-breakpoint
DELETE FROM crm_collection_requests;
--> statement-breakpoint
CREATE INDEX agency_crm_connections_owner_index ON agency_crm_connections(created_by_principal_id,agency_id,provider);
--> statement-breakpoint
-- Compatibility agency_id is now tenant context, including tenants without an
-- agency profile. Keep existing connection ownership and audit history intact.
CREATE TABLE _crm_audit_preserved AS SELECT * FROM agency_crm_connection_audit_events;
--> statement-breakpoint
DROP TABLE agency_crm_connection_audit_events;
--> statement-breakpoint
CREATE TABLE _tenant_crm_connections (
 id TEXT PRIMARY KEY NOT NULL,
 agency_id BIGINT NOT NULL REFERENCES tenants(id),
 created_by_principal_id TEXT NOT NULL REFERENCES identity_principal(id),
 provider TEXT NOT NULL CHECK(provider IN ('hubspot','salesforce','zoho','pipedrive')),
 nango_connection_id TEXT NOT NULL, nango_integration_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','connected','reconnect_required','disconnected','failed')),
 external_account_label TEXT, scopes TEXT NOT NULL DEFAULT '[]',
 last_validated_at TEXT, disconnected_at TEXT, created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, external_account_id TEXT
);
--> statement-breakpoint
INSERT INTO _tenant_crm_connections SELECT * FROM agency_crm_connections;
--> statement-breakpoint
DROP TABLE agency_crm_connections;
--> statement-breakpoint
ALTER TABLE _tenant_crm_connections RENAME TO agency_crm_connections;
--> statement-breakpoint
CREATE INDEX agency_crm_connections_agency_provider_index ON agency_crm_connections(agency_id,provider);
--> statement-breakpoint
CREATE INDEX agency_crm_connections_owner_index ON agency_crm_connections(created_by_principal_id,agency_id,provider);
--> statement-breakpoint
CREATE UNIQUE INDEX agency_crm_connections_active_unique ON agency_crm_connections(created_by_principal_id,agency_id,provider) WHERE disconnected_at IS NULL;
--> statement-breakpoint
CREATE TABLE agency_crm_connection_audit_events (
 id TEXT PRIMARY KEY NOT NULL,
 connection_id TEXT NOT NULL REFERENCES agency_crm_connections(id),
 agency_id BIGINT NOT NULL REFERENCES tenants(id),
 principal_id TEXT NOT NULL REFERENCES identity_principal(id),
 provider TEXT NOT NULL, event_type TEXT NOT NULL, outcome TEXT NOT NULL,
 error_code TEXT, created_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO agency_crm_connection_audit_events SELECT * FROM _crm_audit_preserved;
--> statement-breakpoint
DROP TABLE _crm_audit_preserved;
--> statement-breakpoint
CREATE INDEX agency_crm_connection_audit_events_connection_created_at_index ON agency_crm_connection_audit_events(connection_id,created_at);
--> statement-breakpoint
CREATE INDEX agency_crm_connection_audit_events_agency_created_at_index ON agency_crm_connection_audit_events(agency_id,created_at);
