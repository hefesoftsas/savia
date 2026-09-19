-- Agency profiles can be queried in full by the domain adapter, so existing
-- bindings should advertise the same filter/sort support as newly created ones.
UPDATE crm_collection_bindings
SET config=json_set(
  config,
  '$.capabilities.filter', true,
  '$.capabilities.sort', true
)
WHERE json_extract(config,'$.kind')='domain'
  AND json_extract(config,'$.domain')='agency-network'
  AND json_extract(config,'$.collection')='agency-profiles';
--> statement-breakpoint
UPDATE crm_objects
SET config=json_set(
  config,
  '$.studio.collection.capabilities.filter', true,
  '$.studio.collection.capabilities.sort', true,
  '$.studio.capabilities.filter', true,
  '$.studio.capabilities.sort', true
),
version=version+1
WHERE EXISTS (
  SELECT 1
  FROM crm_collection_bindings b
  WHERE b.tenant_id=crm_objects.tenant_id
    AND b.object_name=crm_objects.name
    AND json_extract(b.config,'$.kind')='domain'
    AND json_extract(b.config,'$.domain')='agency-network'
    AND json_extract(b.config,'$.collection')='agency-profiles'
);
--> statement-breakpoint
INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition)
SELECT tenant_id,name,version,
  json_object(
    'name',name,
    'label',label,
    'description',description,
    'config',json(config),
    'version',version
  )
FROM crm_objects o
WHERE EXISTS (
  SELECT 1
  FROM crm_collection_bindings b
  WHERE b.tenant_id=o.tenant_id
    AND b.object_name=o.name
    AND json_extract(b.config,'$.kind')='domain'
    AND json_extract(b.config,'$.domain')='agency-network'
    AND json_extract(b.config,'$.collection')='agency-profiles'
)
ON CONFLICT(tenant_id,object_name,version) DO NOTHING;
