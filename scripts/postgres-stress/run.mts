import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "../../apps/self-hosted/node_modules/pg/lib/index.js";
import { migratePostgres } from "../../apps/self-hosted/src/postgres/migrations";
import { openPostgresDatabase } from "../../apps/self-hosted/src/postgres/database";
import { createStudioApp } from "../../packages/studio-server/src/index";

// Always creates a disposable database; the supplied database is never migrated or populated.
const url = process.env.SAVIA_TEST_POSTGRES_URL;
if (!url)
  throw Error(
    "Set SAVIA_TEST_POSTGRES_URL to a dedicated test server with CREATE DATABASE rights.",
  );
const rows = Number(process.env.STRESS_ROWS ?? 100_000);
const samples = Number(process.env.STRESS_SAMPLES ?? 10);
const batchSize = Number(process.env.STRESS_BATCH_SIZE ?? 1000);
if (
  !Number.isInteger(rows) ||
  rows < 100 ||
  rows > 2_000_000 ||
  !Number.isInteger(samples) ||
  samples < 1 ||
  samples > 100 ||
  !Number.isInteger(batchSize) ||
  batchSize < 1 ||
  batchSize > 100_000
)
  throw Error(
    "Invalid stress size: rows 100..2000000, samples 1..100, batch size 1..100000.",
  );
const name = `savia_stress_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query(`CREATE DATABASE "${name}"`);
const target = new URL(url);
target.pathname = `/${name}`;
const db = openPostgresDatabase({
  connectionString: target.href,
  schema: "savia_core",
  maxConnections: 10,
});
const app = createStudioApp("stress");
const bindings = {
  DB: db as unknown as D1Database,
  FILES: {} as R2Bucket,
  POC_LOCAL: "false",
};
const request = async (path: string, method = "GET", body?: unknown) => {
  const response = await app.request(
    `http://localhost/api${path}`,
    {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    bindings,
  );
  if (!response.ok)
    throw Error(
      `Stress request ${path}: ${response.status} ${await response.text()}`,
    );
  return response.json() as Promise<any>;
};
const measure = async (run: () => Promise<unknown>) => {
  const times: number[] = [];
  for (let n = 0; n < samples; n++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    p50Ms: times[Math.floor(times.length / 2)],
    p95Ms:
      times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)],
  };
};
try {
  await migratePostgres({
    connectionString: target.href,
    schema: "savia_core",
    directory: resolve("packages/db/postgres"),
    seed: true,
  });
  await request("/objects", "POST", {
    name: "items",
    label: "Stress items",
    config: {
      version: 2,
      fields: {
        name: { type: "Textbox", label: "Name" },
        stage: { type: "Textbox", label: "Stage" },
        amount: { type: "Number", label: "Amount" },
      },
      fieldOrder: ["name", "stage", "amount"],
    },
  });
  const seedStart = performance.now();
  for (let first = 1; first <= rows; first += batchSize)
    await db.pool.query(
      `INSERT INTO studio_records(id,tenant_id,object_name,data)
    SELECT 'row-'||lpad(n::text,9,'0'),'stress','items',json_build_object('name','Item '||lpad(($1::integer-n)::text,9,'0'),'stage','stage-'||(n%10),'amount',n%1000)::text FROM generate_series($2::integer,$3::integer) n`,
      [rows, first, Math.min(rows, first + batchSize - 1)],
    );
  await db.pool.query("ANALYZE studio_records");
  const seedMs = performance.now() - seedStart;
  const page = () => request("/records/items?sort=name&order=ASC&perPage=25");
  const summary = () =>
    request("/records/items/summary?group=stage&amountField=amount");
  const beforeResult = await summary();
  const before = {
    page: await measure(page),
    summary: await measure(summary),
    count: await measure(() =>
      db.pool.query(
        "SELECT count(*) FROM studio_records WHERE tenant_id='stress' AND object_name='items' AND deleted_at IS NULL",
      ),
    ),
  };
  await request("/objects/items/performance", "PATCH", {
    version: 1,
    performance: {
      indexes: [{ fields: ["name"], order: "ASC" }],
      summaries: [{ group: "stage", amountField: "amount" }],
    },
  });
  await db.pool.query("ANALYZE studio_records");
  const after = {
    page: await measure(page),
    summary: await measure(summary),
    count: await measure(() =>
      db.pool.query(
        "SELECT active_count FROM studio_record_counts WHERE tenant_id='stress' AND object_name='items'",
      ),
    ),
  };
  const canonical = (value: any) =>
    JSON.stringify(
      value.data
        .map((r: any) => ({
          value: r.value,
          count: Number(r.count),
          amount: Number(r.amount),
        }))
        .sort((a: any, b: any) =>
          String(a.value).localeCompare(String(b.value)),
        ),
    );
  if (canonical(beforeResult) !== canonical(await summary()))
    throw Error("Summary changed after enabling acceleration.");
  const mixedStart = performance.now();
  const writes = 80;
  await Promise.all(
    Array.from({ length: 8 }, async (_, worker) => {
      for (let n = 0; n < writes / 8; n++) {
        await db.pool.query(
          "UPDATE studio_records SET data=jsonb_set(data::jsonb,'{stage}',to_jsonb($1::text))::text WHERE tenant_id='stress' AND id=$2",
          [
            `stage-${(worker + n) % 10}`,
            `row-${String(worker * 10 + n + 1).padStart(9, "0")}`,
          ],
        );
        await Promise.all([page(), summary()]);
      }
    }),
  );
  const direct = await db.pool.query(
    "SELECT data::jsonb->>'stage' AS value,count(*)::integer AS count,sum((data::jsonb->>'amount')::numeric)::float8 AS amount FROM studio_records WHERE tenant_id='stress' AND object_name='items' AND deleted_at IS NULL GROUP BY 1",
  );
  if (canonical({ data: direct.rows }) !== canonical(await summary()))
    throw Error("Mixed workload summary mismatch.");
  const report = {
    rows,
    samples,
    batchSize,
    applicationCache: false,
    postgresBuffers: "normal shared buffers; not an OS cold-cache benchmark",
    seedMs,
    before,
    after,
    mixed: {
      concurrency: 8,
      writes,
      durationMs: performance.now() - mixedStart,
      errors: 0,
      exactSummaryVerified: true,
    },
  };
  const directory = resolve(".wrangler/postgres-stress");
  await mkdir(directory, { recursive: true });
  const path = resolve(
    directory,
    `${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, path }, null, 2));
} finally {
  await db.close();
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
