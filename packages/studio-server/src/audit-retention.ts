export const STUDIO_AUDIT_RETENTION_LIMIT = 200;

/** Remove older operational audit events independently for each domain. */
export async function purgeStudioAudit(
  db: D1Database,
): Promise<{ deleted: number }> {
  const result = await db
    .prepare(
      `DELETE FROM studio_audit WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY tenant_id ORDER BY created_at DESC, id DESC
          ) AS position
          FROM studio_audit
          WHERE tenant_id LIKE 'domain:%'
        ) WHERE position > ?
      )`,
    )
    .bind(STUDIO_AUDIT_RETENTION_LIMIT)
    .run();
  return { deleted: result.meta.changes ?? 0 };
}
