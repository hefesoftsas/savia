CREATE TABLE crm_solution_installations (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 manifest TEXT NOT NULL CHECK(json_valid(manifest)),
 installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE crm_solution_objects (
 tenant_id TEXT NOT NULL, solution_id TEXT NOT NULL, object_name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)),
 PRIMARY KEY(tenant_id,object_name),
 FOREIGN KEY(tenant_id,solution_id) REFERENCES crm_solution_installations(tenant_id,id)
);
