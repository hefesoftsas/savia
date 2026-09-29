import type pg from "pg";
import { postgresDialect } from "@savia/db/postgres-dialect";
import { recordIndexSql } from "@savia/studio-server/record-performance";
import { recordPerformanceSchema } from "../../../../packages/studio-shared/src/metadata";

/** Install portable index metadata on the caller's locked deployment/import connection. */
export async function ensurePostgresRecordIndexes(client: pg.PoolClient) {
  const objects = await client.query<{
    tenant_id: string;
    name: string;
    config: string;
  }>(
    "SELECT tenant_id,name,config FROM savia_core.studio_objects ORDER BY tenant_id,name",
  );
  for (const object of objects.rows) {
    const config = JSON.parse(object.config);
    if (!config.performance) continue;
    const performance = recordPerformanceSchema.parse(config.performance);
    for (const sql of await recordIndexSql(
      postgresDialect,
      object.tenant_id,
      object.name,
      [],
      performance.indexes,
    ))
      await client.query(sql);
  }
}
