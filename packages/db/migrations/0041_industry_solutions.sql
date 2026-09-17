CREATE TABLE crm_solution_installations (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 manifest TEXT NOT NULL CHECK(json_valid(manifest)),
 installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(tenant_id,id)
);
--> statement-breakpoint
CREATE TABLE crm_solution_objects (
 tenant_id TEXT NOT NULL, solution_id TEXT NOT NULL, object_name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)),
 PRIMARY KEY(tenant_id,object_name),
 FOREIGN KEY(tenant_id,solution_id) REFERENCES crm_solution_installations(tenant_id,id)
);
--> statement-breakpoint
INSERT INTO crm_solution_installations(tenant_id,id,version,manifest)
 SELECT 'agency:' || COALESCE(tenant_id,id),'savia.insurance','0.0.0','{"format": "savia.solution", "formatVersion": 1, "id": "savia.insurance", "version": "0.0.0", "label": "Seguros (configuración existente)", "description": "Instalación adoptada sin modificar datos ni pantallas.", "requires": ["insurance.legacy"], "objects": []}' FROM agencies;
--> statement-breakpoint
INSERT OR IGNORE INTO crm_solution_installations(tenant_id,id,version,manifest)
 SELECT 'domain:platform','savia.insurance','0.0.0','{"format": "savia.solution", "formatVersion": 1, "id": "savia.insurance", "version": "0.0.0", "label": "Seguros (configuración existente)", "description": "Instalación adoptada sin modificar datos ni pantallas.", "requires": ["insurance.legacy"], "objects": []}'
 WHERE EXISTS(SELECT 1 FROM agencies)
 OR EXISTS(SELECT 1 FROM crm_objects WHERE tenant_id='domain:platform' AND (name IN ('polizas','cotizaciones','siniestros','aseguradoras') OR json_extract(config,'$.studio.business') IN ('quotation','managed-agency')));
--> statement-breakpoint
INSERT OR IGNORE INTO crm_solution_installations(tenant_id,id,version,manifest)
 SELECT DISTINCT tenant_id,'savia.insurance','0.0.0','{"format": "savia.solution", "formatVersion": 1, "id": "savia.insurance", "version": "0.0.0", "label": "Seguros (configuración existente)", "description": "Instalación adoptada sin modificar datos ni pantallas.", "requires": ["insurance.legacy"], "objects": []}' FROM crm_objects
 WHERE name IN ('polizas','cotizaciones','siniestros','aseguradoras') OR json_extract(config,'$.studio.business') IN ('quotation','managed-agency');
--> statement-breakpoint
INSERT INTO crm_solution_objects(tenant_id,solution_id,object_name,definition)
 SELECT o.tenant_id,'savia.insurance',o.name,json_object('name',o.name,'label',o.label,'description',o.description,'config',json(o.config)) FROM crm_objects o
 JOIN crm_solution_installations s ON s.tenant_id=o.tenant_id AND s.id='savia.insurance'
 WHERE o.name IN ('polizas','cotizaciones','siniestros','aseguradoras') OR json_extract(o.config,'$.studio.business') IN ('quotation','managed-agency')
 OR json_extract(o.config,'$.studio.collection.domain') IN ('insurance-catalog','policy-lifecycle','sales-pipeline','claims');
