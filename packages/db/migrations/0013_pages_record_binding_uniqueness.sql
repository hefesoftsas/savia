-- Keep all existing page content while detaching duplicate record bindings.
WITH ranked_bindings AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id,
             json_extract(binding_json, '$.domain'),
             json_extract(binding_json, '$.collection'),
             json_extract(binding_json, '$.recordId')
           ORDER BY created_at, id
         ) AS binding_rank
  FROM pages
  WHERE binding_json IS NOT NULL AND json_valid(binding_json)
)
UPDATE pages
SET binding_json = NULL
WHERE id IN (SELECT id FROM ranked_bindings WHERE binding_rank > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX pages_record_binding_unique
ON pages (
  tenant_id,
  json_extract(binding_json, '$.domain'),
  json_extract(binding_json, '$.collection'),
  json_extract(binding_json, '$.recordId')
)
WHERE binding_json IS NOT NULL AND json_valid(binding_json);
