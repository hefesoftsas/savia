UPDATE crm_solution_installations
SET
  manifest = json_set(manifest, '$.requires', json('["insurance.quotes"]')),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE
  id = 'savia.insurance'
  AND json_extract(manifest, '$.requires[0]') = 'insurance.legacy';
