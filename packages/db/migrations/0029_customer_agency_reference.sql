-- Expose the existing profile reference as a selectable CRM field; no operational data changes.
UPDATE crm_collection_bindings SET config=json_set(config,'$.fieldPaths.agency_id',json('["agencyId"]'))
WHERE json_extract(config,'$.kind')='domain' AND json_extract(config,'$.domain')='customer-portfolio' AND json_extract(config,'$.collection')='customer-profiles';
--> statement-breakpoint
UPDATE crm_objects SET config=json_set(config,
 '$.fields.agency_id',json('{"type":"Textbox","label":"ID de agencia","readOnly":true}'),
 '$.studio.collection.fieldPaths.agency_id',json('["agencyId"]'),
 '$.fieldOrder',json_insert(json_extract(config,'$.fieldOrder'),'$[#]','agency_id')),
 version=version+1
WHERE NOT EXISTS (SELECT 1 FROM json_each(crm_objects.config,'$.fields') WHERE key='agency_id')
AND EXISTS (SELECT 1 FROM crm_collection_bindings b WHERE b.tenant_id=crm_objects.tenant_id AND b.object_name=crm_objects.name AND json_extract(b.config,'$.domain')='customer-portfolio' AND json_extract(b.config,'$.collection')='customer-profiles');
--> statement-breakpoint
INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition)
SELECT tenant_id,name,version,json_object('name',name,'label',label,'description',description,'config',json(config),'version',version)
FROM crm_objects o WHERE EXISTS (SELECT 1 FROM crm_collection_bindings b WHERE b.tenant_id=o.tenant_id AND b.object_name=o.name AND json_extract(b.config,'$.domain')='customer-portfolio' AND json_extract(b.config,'$.collection')='customer-profiles')
ON CONFLICT(tenant_id,object_name,version) DO NOTHING;
