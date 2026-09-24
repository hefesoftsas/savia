import {
  publishRealtime,
  type RealtimeHubClient,
} from "../realtime/hub-client";

/** One payload-free invalidation per collection, after the bundle commits. */
export async function publishRecordBundleChanges(options: {
  db: D1Database;
  tenant: string;
  room: string;
  actor: string;
  object: string;
  response: Response;
  hub?: RealtimeHubClient;
}): Promise<void> {
  const { db, tenant, room, actor, object, response, hub } = options;
  if (!response.ok) return;
  try {
    const result = (await response.clone().json()) as {
      related?: { relationId: string }[];
    };
    if (!Array.isArray(result.related) || result.related.length > 10) return;
    const collections = new Set([object]);
    for (const group of result.related) {
      if (typeof group?.relationId !== "string") continue;
      const relation = await db
        .prepare(
          "SELECT source_object,target_object FROM studio_collection_relations WHERE tenant_id=? AND id=?",
        )
        .bind(tenant, group.relationId)
        .first<{ source_object: string; target_object: string }>();
      if (relation?.source_object === object)
        collections.add(relation.target_object);
      else if (relation?.target_object === object)
        collections.add(relation.source_object);
    }
    for (const collection of collections) {
      let version: number | undefined;
      try {
        const bumped = await db
          .prepare(
            `INSERT INTO studio_collection_versions(tenant_id, collection, version, updated_at)
          VALUES(?, ?, 1, ?) ON CONFLICT(tenant_id, collection) DO UPDATE
          SET version=version+1, updated_at=excluded.updated_at RETURNING version`,
          )
          .bind(tenant, collection, new Date().toISOString())
          .first<{ version: number }>();
        version = bumped?.version;
      } catch {
        /* A hint must not fail an already committed mutation. */
      }
      publishRealtime(hub, room, {
        topic: "records",
        type: "updated",
        collection,
        ...(version !== undefined ? { version } : {}),
        actor,
      });
    }
  } catch {
    /* Realtime is best effort, including metadata lookup. */
  }
}
