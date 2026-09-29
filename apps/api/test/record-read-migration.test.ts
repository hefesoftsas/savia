import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
async function apply(sql: string) {
  for (const part of sql.split("--> statement-breakpoint")) {
    const statement = part
      .replace(/^--.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (statement) await env.DB.exec(statement);
  }
}
it("backfills existing active and deleted records without changing their contents", async () => {
  const additions = migrations.filter(([name]) => /\/(0079|0080)_/.test(name));
  for (const [name, sql] of migrations)
    if (!/\/(0079|0080)_/.test(name)) await apply(sql);
  await env.DB.prepare(
    "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES ('upgrade','items','Items','{\"fields\":{}}')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO studio_records(tenant_id,id,object_name,data,deleted_at) VALUES ('upgrade','old-live','items',?,NULL),('upgrade','old-trash','items',?,'2026-01-01')",
  )
    .bind(
      JSON.stringify({ title: "existing live needle" }),
      JSON.stringify({ title: "existing trash needle" }),
    )
    .run();
  const before = (
    await env.DB.prepare("SELECT * FROM studio_records ORDER BY id").all()
  ).results;
  for (const [, sql] of additions) await apply(sql);
  expect(
    (await env.DB.prepare("SELECT * FROM studio_records ORDER BY id").all())
      .results,
  ).toEqual(before);
  expect(
    await env.DB.prepare(
      "SELECT active_count,trash_count FROM studio_record_counts WHERE tenant_id='upgrade' AND object_name='items'",
    ).first(),
  ).toEqual({ active_count: 1, trash_count: 1 });
  const result = await env.DB.prepare(
    "SELECT record_id FROM studio_record_search_fts WHERE studio_record_search_fts MATCH ? ORDER BY record_id",
  )
    .bind('"needle"')
    .all<{ record_id: string }>();
  expect(result.results.map((r) => r.record_id)).toEqual([
    "old-live",
    "old-trash",
  ]);
});
