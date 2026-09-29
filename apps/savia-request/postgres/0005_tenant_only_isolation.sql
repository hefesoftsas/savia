-- Request-store scope migration. The main Savia migration may have already
-- copied its authoritative old-key map into this store before this runs.
CREATE TABLE IF NOT EXISTS tenant_namespace_migrations (
  old_key TEXT PRIMARY KEY,
  tenant_id BIGINT NOT NULL
);
--> statement-breakpoint
INSERT INTO tenant_namespace_migrations(old_key,tenant_id)
SELECT 'domain:platform',0
WHERE current_setting('savia.seed',true) IS DISTINCT FROM 'false'
   OR EXISTS(SELECT 1 FROM tenant_flows WHERE tenant_id='domain:platform')
   OR EXISTS(SELECT 1 FROM tenant_flow_variables WHERE tenant_id='domain:platform')
   OR EXISTS(SELECT 1 FROM tenant_flow_versions WHERE tenant_id='domain:platform')
   OR EXISTS(SELECT 1 FROM tenant_flow_runs WHERE tenant_id='domain:platform')
   OR EXISTS(SELECT 1 FROM tenant_folders WHERE tenant_id='domain:platform')
   OR EXISTS(SELECT 1 FROM tenant_bundles WHERE tenant_id='domain:platform')
   OR EXISTS(SELECT 1 FROM bundle_flow_state WHERE scope='domain:platform')
   OR EXISTS(SELECT 1 FROM savia_request_audit WHERE tenant_id='domain:platform')
ON CONFLICT(old_key) DO NOTHING;
--> statement-breakpoint
WITH scopes(value) AS (
  SELECT tenant_id FROM tenant_flows
  UNION SELECT tenant_id FROM tenant_flow_variables
  UNION SELECT tenant_id FROM tenant_flow_versions
  UNION SELECT tenant_id FROM tenant_flow_runs
  UNION SELECT tenant_id FROM tenant_folders
  UNION SELECT tenant_id FROM tenant_bundles
  UNION SELECT scope FROM bundle_flow_state
  UNION SELECT tenant_id FROM savia_request_audit
)
INSERT INTO tenant_namespace_migrations(old_key,tenant_id)
SELECT value,substring(value FROM 8)::BIGINT
FROM scopes
WHERE value ~ '^agency:(0|[1-9][0-9]{0,15})$'
  AND substring(value FROM 8)::NUMERIC<=9007199254740991
ON CONFLICT(old_key) DO NOTHING;
--> statement-breakpoint
CREATE TABLE tenant_namespace_guard (
  collision INTEGER CONSTRAINT tenant_namespace_collision CHECK(collision=0),
  unmapped INTEGER CONSTRAINT tenant_namespace_unmapped CHECK(unmapped=0),
  invalid INTEGER CONSTRAINT tenant_namespace_invalid CHECK(invalid=0)
);
--> statement-breakpoint
WITH scopes(value) AS (
  SELECT tenant_id FROM tenant_flows
  UNION ALL SELECT tenant_id FROM tenant_flow_variables
  UNION ALL SELECT tenant_id FROM tenant_flow_versions
  UNION ALL SELECT tenant_id FROM tenant_flow_runs
  UNION ALL SELECT tenant_id FROM tenant_folders
  UNION ALL SELECT tenant_id FROM tenant_bundles
  UNION ALL SELECT scope FROM bundle_flow_state
  UNION ALL SELECT tenant_id FROM savia_request_audit
)
INSERT INTO tenant_namespace_guard(unmapped)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM scopes s
  WHERE (s.value LIKE 'domain:%' OR s.value LIKE 'agency:%')
    AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.value)
) THEN 1 ELSE 0 END;
--> statement-breakpoint
WITH scopes(value) AS (
  SELECT tenant_id FROM tenant_flows
  UNION ALL SELECT tenant_id FROM tenant_flow_variables
  UNION ALL SELECT tenant_id FROM tenant_flow_versions
  UNION ALL SELECT tenant_id FROM tenant_flow_runs
  UNION ALL SELECT tenant_id FROM tenant_folders
  UNION ALL SELECT tenant_id FROM tenant_bundles
  UNION ALL SELECT scope FROM bundle_flow_state
  UNION ALL SELECT tenant_id FROM savia_request_audit
)
INSERT INTO tenant_namespace_guard(invalid)
SELECT CASE WHEN
  EXISTS(
    SELECT 1 FROM tenant_namespace_migrations m
    WHERE m.tenant_id<0 OR m.tenant_id>9007199254740991
      OR (m.old_key='domain:platform' AND m.tenant_id<>0)
      OR (m.old_key LIKE 'agency:%' AND
        (m.old_key<>'agency:'||m.tenant_id OR m.tenant_id<0))
  ) OR EXISTS(
    SELECT 1 FROM scopes s
    WHERE s.value LIKE 'agency:%' AND
      (s.value !~ '^agency:(0|[1-9][0-9]{0,15})$' OR
        CASE WHEN substring(s.value FROM 8) ~ '^[0-9]+$'
          THEN substring(s.value FROM 8)::NUMERIC>9007199254740991 ELSE TRUE END)
  ) OR EXISTS(
    SELECT 1 FROM scopes s
    WHERE s.value LIKE 'tenant:%' AND
      (s.value !~ '^tenant:(0|[1-9][0-9]{0,15})$' OR
        CASE WHEN substring(s.value FROM 8) ~ '^[0-9]+$'
          THEN substring(s.value FROM 8)::NUMERIC>9007199254740991 ELSE TRUE END)
  ) OR EXISTS(
    SELECT 1 FROM scopes s
    WHERE s.value<>'' AND s.value NOT LIKE 'tenant:%'
      AND s.value NOT LIKE 'agency:%' AND s.value NOT LIKE 'domain:%'
  )
THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM tenant_flows s
  GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s.flow_id
  HAVING COUNT(*)>1
) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM tenant_flow_variables s
  GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s.flow_id,s.key
  HAVING COUNT(*)>1
) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM tenant_folders s
  GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s.path
  HAVING COUNT(*)>1
) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM tenant_bundles s
  GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id),s.tenant_id),s.id
  HAVING COUNT(*)>1
) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(collision)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM bundle_flow_state s
  GROUP BY COALESCE('tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope),s.scope),s.flow_id
  HAVING COUNT(*)>1
) THEN 1 ELSE 0 END;
--> statement-breakpoint
UPDATE tenant_flows AS s SET tenant_id='tenant:'||m.tenant_id
FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id;
--> statement-breakpoint
UPDATE tenant_flow_variables AS s SET tenant_id='tenant:'||m.tenant_id
FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id;
--> statement-breakpoint
UPDATE tenant_flow_versions AS s SET tenant_id='tenant:'||m.tenant_id
FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id;
--> statement-breakpoint
UPDATE tenant_flow_runs AS s SET tenant_id='tenant:'||m.tenant_id
FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id;
--> statement-breakpoint
UPDATE tenant_folders AS s SET tenant_id='tenant:'||m.tenant_id
FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id;
--> statement-breakpoint
UPDATE tenant_bundles AS s SET tenant_id='tenant:'||m.tenant_id
FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id;
--> statement-breakpoint
UPDATE bundle_flow_state AS s SET scope='tenant:'||m.tenant_id
FROM tenant_namespace_migrations m WHERE m.old_key=s.scope;
--> statement-breakpoint
UPDATE savia_request_audit AS s SET tenant_id='tenant:'||m.tenant_id
FROM tenant_namespace_migrations m WHERE m.old_key=s.tenant_id;
--> statement-breakpoint
DROP TABLE tenant_namespace_guard;
