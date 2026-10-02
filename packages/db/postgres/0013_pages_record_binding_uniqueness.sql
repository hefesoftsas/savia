-- Keep all existing page content while detaching duplicate record bindings.
WITH ranked_bindings AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id,
             binding_json::jsonb ->> 'domain',
             binding_json::jsonb ->> 'collection',
             binding_json::jsonb ->> 'recordId'
           ORDER BY created_at, id
         ) AS binding_rank
  FROM pages
  WHERE binding_json IS NOT NULL
)
UPDATE pages AS page
SET binding_json = NULL
FROM ranked_bindings AS ranked
WHERE page.id = ranked.id AND ranked.binding_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX pages_record_binding_unique
ON pages (
  tenant_id,
  ((binding_json::jsonb ->> 'domain')),
  ((binding_json::jsonb ->> 'collection')),
  ((binding_json::jsonb ->> 'recordId'))
)
WHERE binding_json IS NOT NULL;
