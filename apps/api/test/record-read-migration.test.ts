import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";

const baseline = Object.entries(
  import.meta.glob<string>(
    "../../../packages/db/migrations/000{1_initial,2_bootstrap}.sql",
    {
      eager: true,
      import: "default",
      query: "?raw",
    },
  ),
).sort(([a], [b]) => a.localeCompare(b));

beforeAll(async () => {
  expect(baseline).toHaveLength(2);
  for (const [, sql] of baseline) {
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  }
});

it("keeps baseline record counts, search, and summaries current as records change", async () => {
  await env.DB.prepare(
    "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('tenant:900','items','Items','{}')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO studio_record_summary_definitions(tenant_id,object_name,group_field,amount_field) VALUES('tenant:900','items','status','amount')",
  ).run();
  await env.DB.prepare(
    'INSERT INTO studio_records(tenant_id,id,object_name,data,deleted_at) VALUES(\'tenant:900\',\'live\',\'items\',\'{"title":"needle live","status":"open","amount":5}\',NULL),(\'tenant:900\',\'deleted\',\'items\',\'{"title":"needle deleted","status":"open","amount":4}\',\'2026-01-01\')',
  ).run();

  expect(
    await env.DB.prepare(
      "SELECT active_count,trash_count FROM studio_record_counts WHERE tenant_id='tenant:900' AND object_name='items'",
    ).first(),
  ).toEqual({ active_count: 1, trash_count: 1 });
  expect(
    (
      await env.DB.prepare(
        "SELECT record_id FROM studio_record_search_fts WHERE studio_record_search_fts MATCH 'needle' ORDER BY record_id",
      ).all<{ record_id: string }>()
    ).results.map((row) => row.record_id),
  ).toEqual(["deleted", "live"]);
  expect(
    await env.DB.prepare(
      "SELECT record_count,amount FROM studio_record_summary_groups WHERE tenant_id='tenant:900' AND object_name='items' AND value_key='open'",
    ).first(),
  ).toMatchObject({ record_count: 1, amount: 5 });

  await env.DB.prepare(
    "UPDATE studio_records SET deleted_at=NULL WHERE tenant_id='tenant:900' AND id='deleted'",
  ).run();
  expect(
    await env.DB.prepare(
      "SELECT active_count,trash_count FROM studio_record_counts WHERE tenant_id='tenant:900' AND object_name='items'",
    ).first(),
  ).toEqual({ active_count: 2, trash_count: 0 });
  expect(
    await env.DB.prepare(
      "SELECT record_count,amount FROM studio_record_summary_groups WHERE tenant_id='tenant:900' AND object_name='items' AND value_key='open'",
    ).first(),
  ).toMatchObject({ record_count: 2, amount: 9 });
});
