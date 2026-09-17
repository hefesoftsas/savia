CREATE TABLE crm_collection_sources (
 tenant_id TEXT NOT NULL,
 id TEXT NOT NULL,
 label TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind='jsonapi'),
 config TEXT NOT NULL CHECK(json_valid(config)),
 encrypted_secret TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE crm_collection_bindings (
 tenant_id TEXT NOT NULL,
 object_name TEXT NOT NULL,
 source_id TEXT NOT NULL,
 resource TEXT NOT NULL,
 config TEXT NOT NULL CHECK(json_valid(config)),
 PRIMARY KEY(tenant_id,object_name),
 FOREIGN KEY(tenant_id,object_name) REFERENCES crm_objects(tenant_id,name)
);
--> statement-breakpoint
CREATE TABLE crm_collection_requests (
 tenant_id TEXT NOT NULL,
 request_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','success')),
 response TEXT CHECK(response IS NULL OR json_valid(response)),
 PRIMARY KEY(tenant_id,request_key)
);
