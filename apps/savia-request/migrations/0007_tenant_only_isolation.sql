CREATE TABLE IF NOT EXISTS tenant_namespace_migrations (
  old_key TEXT PRIMARY KEY,
  tenant_id BIGINT NOT NULL
);
--> statement-breakpoint
DROP TABLE IF EXISTS tenant_namespace_scope_values;
--> statement-breakpoint
CREATE TABLE tenant_namespace_scope_values(value TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO tenant_namespace_scope_values SELECT tenant_id FROM tenant_flows;
--> statement-breakpoint
INSERT INTO tenant_namespace_scope_values SELECT tenant_id FROM tenant_flow_variables;
--> statement-breakpoint
INSERT INTO tenant_namespace_scope_values SELECT tenant_id FROM tenant_flow_versions;
--> statement-breakpoint
INSERT INTO tenant_namespace_scope_values SELECT tenant_id FROM tenant_flow_runs;
--> statement-breakpoint
INSERT INTO tenant_namespace_scope_values SELECT tenant_id FROM tenant_folders;
--> statement-breakpoint
INSERT INTO tenant_namespace_scope_values SELECT tenant_id FROM tenant_bundles;
--> statement-breakpoint
INSERT INTO tenant_namespace_scope_values SELECT scope FROM bundle_flow_state;
--> statement-breakpoint
INSERT INTO tenant_namespace_scope_values SELECT tenant_id FROM savia_request_audit;
--> statement-breakpoint
INSERT INTO tenant_namespace_migrations(old_key,tenant_id)
VALUES ('domain:platform',0) ON CONFLICT(old_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO tenant_namespace_migrations(old_key,tenant_id)
SELECT value,CAST(substr(value,8) AS INTEGER)
FROM tenant_namespace_scope_values
WHERE value GLOB 'agency:[0-9]*'
  AND substr(value,8) NOT GLOB '*[^0-9]*'
  AND CAST(substr(value,8) AS INTEGER)>=0
  AND length(substr(value,8))<=16
  AND CAST(substr(value,8) AS INTEGER)<=9007199254740991
ON CONFLICT(old_key) DO NOTHING;
--> statement-breakpoint
CREATE TABLE tenant_namespace_guard (
  collision INTEGER CONSTRAINT tenant_namespace_collision CHECK(collision=0),
  unmapped INTEGER CONSTRAINT tenant_namespace_unmapped CHECK(unmapped=0),
  invalid INTEGER CONSTRAINT tenant_namespace_invalid CHECK(invalid=0)
);
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(unmapped)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM tenant_namespace_scope_values s
  WHERE (s.value LIKE 'domain:%' OR s.value LIKE 'agency:%')
    AND NOT EXISTS(SELECT 1 FROM tenant_namespace_migrations m WHERE m.old_key=s.value)
) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO tenant_namespace_guard(invalid)
SELECT CASE WHEN
  EXISTS(
    SELECT 1 FROM tenant_namespace_migrations m
    WHERE m.tenant_id<0 OR m.tenant_id>9007199254740991
      OR (m.old_key='domain:platform' AND m.tenant_id<>0)
      OR (m.old_key LIKE 'agency:%' AND
        (m.old_key<>'agency:'||m.tenant_id OR m.tenant_id<0))
  ) OR EXISTS(
    SELECT 1 FROM tenant_namespace_scope_values s
    WHERE s.value LIKE 'agency:%' AND
      (s.value<>'agency:'||CAST(substr(s.value,8) AS INTEGER)
        OR CAST(substr(s.value,8) AS INTEGER)<0
        OR CAST(substr(s.value,8) AS INTEGER)>9007199254740991)
  ) OR EXISTS(
    SELECT 1 FROM tenant_namespace_scope_values s
    WHERE s.value LIKE 'tenant:%' AND
      (s.value<>'tenant:'||CAST(substr(s.value,8) AS INTEGER)
        OR CAST(substr(s.value,8) AS INTEGER)<0
        OR CAST(substr(s.value,8) AS INTEGER)>9007199254740991)
  ) OR EXISTS(
    SELECT 1 FROM tenant_namespace_scope_values s
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
UPDATE tenant_flows AS s SET tenant_id='tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id)
WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations WHERE old_key=s.tenant_id);
--> statement-breakpoint
UPDATE tenant_flow_variables AS s SET tenant_id='tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id)
WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations WHERE old_key=s.tenant_id);
--> statement-breakpoint
UPDATE tenant_flow_versions AS s SET tenant_id='tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id)
WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations WHERE old_key=s.tenant_id);
--> statement-breakpoint
UPDATE tenant_flow_runs AS s SET tenant_id='tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id)
WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations WHERE old_key=s.tenant_id);
--> statement-breakpoint
UPDATE tenant_folders AS s SET tenant_id='tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id)
WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations WHERE old_key=s.tenant_id);
--> statement-breakpoint
UPDATE tenant_bundles AS s SET tenant_id='tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id)
WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations WHERE old_key=s.tenant_id);
--> statement-breakpoint
UPDATE bundle_flow_state AS s SET scope='tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.scope)
WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations WHERE old_key=s.scope);
--> statement-breakpoint
UPDATE savia_request_audit AS s SET tenant_id='tenant:'||(SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key=s.tenant_id)
WHERE EXISTS(SELECT 1 FROM tenant_namespace_migrations WHERE old_key=s.tenant_id);
--> statement-breakpoint
DROP TABLE tenant_namespace_guard;
--> statement-breakpoint
DROP TABLE tenant_namespace_scope_values;
--> statement-breakpoint
