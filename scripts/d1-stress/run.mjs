import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir, cpus, totalmem } from "node:os";
import { execFileSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "apps/api/package.json"));
const dependency = (name) =>
  require(
    require.resolve(name, { paths: [dirname(require.resolve("wrangler"))] }),
  );
const { Miniflare, convertV4MiniflareOptions } = dependency("miniflare");
const { build } = dependency("esbuild");
const sizes = (process.env.STRESS_SIZES ?? "10000,100000,1000000")
  .split(",")
  .map(Number);
const concurrencyLevels = (process.env.STRESS_CONCURRENCY ?? "1,8,32")
  .split(",")
  .map(Number);
const samples = Number(process.env.STRESS_SAMPLES ?? 32);
const mixedSamples = Number(process.env.STRESS_MIXED_SAMPLES ?? samples);
const coldReads = process.env.STRESS_COLD === "1";
const mixedSameCollection = process.env.STRESS_MIXED_SAME_COLLECTION === "1";
const performanceEnabled =
  process.env.STRESS_PERFORMANCE === "1" || mixedSameCollection;
if (!Number.isInteger(mixedSamples) || mixedSamples < 2 || mixedSamples > 500)
  throw Error("Invalid mixed sample count");
const stopP95Ms = Number(process.env.STRESS_STOP_P95_MS ?? 30000);
if (!Number.isFinite(stopP95Ms) || stopP95Ms < 1)
  throw Error("Invalid stop latency");
if (
  !sizes.every(
    (v, i) =>
      Number.isInteger(v) &&
      v >= 100 &&
      v <= 1000000 &&
      (!i || v > sizes[i - 1]),
  ) ||
  !concurrencyLevels.every((v) => Number.isInteger(v) && v >= 1 && v <= 64) ||
  !Number.isInteger(samples) ||
  samples < 2 ||
  samples > 500
)
  throw Error("Invalid bounded stress configuration");
const output = resolve(
  process.env.STRESS_OUTPUT ??
    resolve(
      root,
      ".wrangler/d1-stress/reports/" +
        new Date().toISOString().replaceAll(":", "-"),
    ),
);
await mkdir(output, { recursive: true });
const temp = await mkdtemp(resolve(tmpdir(), "savia-d1-stress-"));
const report = {
  startedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  environment: {
    node: process.version,
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    ramGB: Math.round(totalmem() / 2 ** 30),
    miniflare: require(require.resolve("miniflare/package.json")).version,
  },
  sizes,
  concurrencyLevels,
  samples,
  mixedSamples,
  performanceEnabled,
  coldReads,
  mixedSameCollection,
  stages: [],
};
report.harness = {};
for (const file of ["run.mjs", "worker.ts"]) {
  const source = await readFile(resolve(root, "scripts/d1-stress", file));
  report.harness[file] = createHash("sha256").update(source).digest("hex");
  await writeFile(resolve(output, "measured-" + file), source);
}
report.notes = [
  "Local closed-loop bursts, not an open-loop sustained-capacity test.",
  "OAuth, ACL, external services and browser/network latency excluded.",
  "D1 first() has no metadata; rowsRead is a lower bound excluding these lookups.",
  "No histories configured; all records active; no installed plugins or workflows.",
];
let mf;
const save = () =>
  writeFile(resolve(output, "results.json"), JSON.stringify(report, null, 2));
function percentile(values, fraction) {
  return (
    [...values].sort((a, b) => a - b)[
      Math.max(0, Math.ceil(values.length * fraction) - 1)
    ] ?? null
  );
}
try {
  await build({
    entryPoints: [resolve(root, "scripts/d1-stress/worker.ts")],
    outfile: resolve(temp, "worker.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      modules: true,
      script: await readFile(resolve(temp, "worker.mjs"), "utf8"),
      compatibilityDate: "2026-09-01",
      d1Databases: { DB: "isolated-stress" },
      r2Buckets: ["FILES"],
    }),
  );
  const db = await mf.getD1Database("DB");
  const migrations = (await readdir(resolve(root, "packages/db/migrations")))
    .filter((x) => x.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    const sql = await readFile(
      resolve(root, "packages/db/migrations", file),
      "utf8",
    );
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await db.exec(statement);
    }
  }
  console.log(
    `Applied ${migrations.length} real migrations to disposable local D1.`,
  );
  const config = {
    version: 2,
    fields: {
      name: { type: "Textbox", label: "Name" },
      email: { type: "Textbox", label: "Email" },
      stage: { type: "Textbox", label: "Stage" },
      amount: { type: "Number", label: "Amount" },
      notes: { type: "Textbox", label: "Notes" },
    },
    fieldOrder: ["name", "email", "stage", "amount", "notes"],
  };
  for (const tenant of ["900001", "900002"])
    for (const name of ["contacts", "deals"])
      await db
        .prepare(
          "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES (?,?,?,?)",
        )
        .bind(tenant, name, name, JSON.stringify(config))
        .run();
  const request = async (input, { cold = false } = {}) => {
    const started = performance.now();
    const response = await mf.dispatchFetch("http://127.0.0.1/probe", {
      method: "POST",
      body: JSON.stringify({ ...input, cold }),
    });
    const result = await response.json();
    return { ...result, ms: performance.now() - started };
  };
  if (performanceEnabled || mixedSameCollection) {
    const performance = {
      indexes: [
        { fields: ["name"], order: "ASC" },
        { fields: ["stage", "updated_at"], order: "DESC" },
      ],
      summaries: [{ group: "stage", amountField: "amount" }],
    };
    for (const name of ["contacts", "deals"]) {
      const configured = await request({
        path: `/api/objects/${name}/performance`,
        method: "PATCH",
        body: { version: 1, performance },
      });
      if (configured.status !== 200)
        throw Error(
          `Could not configure ${name} performance: ${JSON.stringify(configured.body)}`,
        );
    }
  }
  let seeded = 0;
  volumeLoop: for (const size of sizes) {
    const seedStart = performance.now();
    while (seeded < size) {
      const end = Math.min(size, seeded + 2000);
      await db
        .prepare(
          `WITH RECURSIVE seq(n) AS (SELECT ? UNION ALL SELECT n+1 FROM seq WHERE n<?)
        INSERT INTO studio_records(id,tenant_id,object_name,data,created_at,updated_at)
        SELECT printf('r%09d',n), CASE WHEN n%10=0 THEN '900002' ELSE '900001' END,
        CASE WHEN n%5=0 THEN 'deals' ELSE 'contacts' END,
        json_object('name',printf('Contact %09d',n),'email',printf('person%09d@example.invalid',n),'stage',CASE WHEN n%4=0 THEN 'won' ELSE 'open' END,'amount',n%10000,'notes',printf('%.*c',256,120)),
        strftime('%Y-%m-%dT%H:%M:%fZ','2025-01-01','+'||n||' seconds'),strftime('%Y-%m-%dT%H:%M:%fZ','2025-01-01','+'||n||' seconds') FROM seq`,
        )
        .bind(seeded + 1, end)
        .run();
      seeded = end;
      if (seeded % 100000 === 0)
        console.log(`Seeded ${seeded} records (original triggers enabled).`);
    }
    const isolationProbe = await request({
      path: "/api/records/deals/r000000010",
    });
    if (isolationProbe.status !== 404)
      throw Error("Cross-tenant record unexpectedly visible");
    const active = Number(
      await db
        .prepare(
          "SELECT count(*) FROM studio_records WHERE tenant_id='900001' AND object_name='contacts' AND deleted_at IS NULL",
        )
        .first("count(*)"),
    );
    const stage = {
      size,
      active,
      seedMs: performance.now() - seedStart,
      tables: await db
        .prepare(
          "SELECT 'studio_records' AS name,count(*) AS rows FROM studio_records UNION ALL SELECT 'crm_sync_changes',count(*) FROM crm_sync_changes UNION ALL SELECT 'studio_record_history',count(*) FROM studio_record_history",
        )
        .all(),
      scenarios: [],
    };
    report.stages.push(stage);
    const scenarios = [
      {
        name: "lookup-by-id",
        path: "/api/records/contacts/r000000001",
        kind: "one",
      },
      {
        name: "list-first-page",
        path: "/api/records/contacts?perPage=25",
        kind: "list",
      },
      {
        name: "list-deep-page",
        path:
          "/api/records/contacts?perPage=25&page=" +
          Math.max(1, Math.floor((active * 0.9) / 25)),
        kind: "list",
      },
      {
        name: "sort-json-field",
        path: "/api/records/contacts?perPage=25&sort=name&order=ASC",
        kind: "list",
      },
      {
        name: "filter-json-field",
        path:
          "/api/records/contacts?perPage=25&filters=" +
          encodeURIComponent(
            JSON.stringify({
              conditions: [{ field: "stage", op: "eq", value: "won" }],
            }),
          ),
        kind: "filter",
      },
      {
        name: "search-all-fields",
        path: "/api/records/contacts?perPage=25&q=person000000001",
        kind: "search",
      },
      {
        name: "group-summary",
        path: "/api/records/contacts/summary?group=stage&amountField=amount",
        kind: "summary",
      },
      { name: "menu-counts", path: "/api/objects", kind: "menu" },
    ];
    if (performanceEnabled) {
      scenarios.push(
        {
          name: "performance-indexed-sort-name",
          path: "/api/records/contacts?perPage=25&sort=name&order=ASC",
          kind: "list",
        },
        {
          name: "performance-indexed-filter-sort",
          path: "/api/records/contacts?perPage=25&stage=open&sort=updated_at&order=DESC",
          kind: "filter",
        },
        {
          name: "performance-summary-stage-amount",
          path: "/api/records/contacts/summary?group=stage&amountField=amount",
          kind: "summary",
        },
      );
    }
    if (process.env.STRESS_CURSOR === "1") {
      const deepPage = Math.max(1, Math.floor((active * 0.9) / 25));
      const anchor = await request({
        path: "/api/records/contacts?perPage=25&page=" + deepPage,
      });
      if (!anchor.body.nextCursor)
        throw Error("Cursor probe requires a nextCursor response");
      scenarios.push({
        name: "list-cursor-page",
        path:
          "/api/records/contacts?perPage=25&cursor=" +
          encodeURIComponent(anchor.body.nextCursor),
        kind: "list",
      });
      if (performanceEnabled) {
        const nameAnchor = await request({
          path:
            "/api/records/contacts?perPage=25&page=" +
            deepPage +
            "&sort=name&order=ASC",
        });
        if (nameAnchor.status !== 200 || !nameAnchor.body.nextCursor)
          throw Error(
            `Custom-name cursor probe requires a nextCursor response: ${JSON.stringify(nameAnchor.body)}`,
          );
        scenarios.push({
          name: "performance-cursor-name",
          path:
            "/api/records/contacts?perPage=25&sort=name&order=ASC&cursor=" +
            encodeURIComponent(nameAnchor.body.nextCursor),
          kind: "list",
        });
      }
    }
    for (const scenario of scenarios.filter(
      (s) =>
        !process.env.STRESS_SCENARIOS ||
        process.env.STRESS_SCENARIOS.split(",").includes(s.name),
    )) {
      const warmup = await request(scenario, { cold: coldReads });
      if (warmup.status !== 200)
        throw Error(`${scenario.name}: ${JSON.stringify(warmup.body)}`);
      if (
        ["list", "filter", "search"].includes(scenario.kind) &&
        (!Array.isArray(warmup.body.data) ||
          warmup.body.data.length > 25 ||
          !Number.isFinite(warmup.body.total))
      )
        throw Error("Invalid page response");
      if (scenario.kind === "list" && warmup.body.total !== active)
        throw Error("Incorrect tenant-scoped count");
      if (scenario.kind === "search" && warmup.body.total !== 1)
        throw Error("Search lost its known record");
      if (
        scenario.kind === "summary" &&
        warmup.body.data.reduce((n, r) => n + r.count, 0) !== active
      )
        throw Error("Summary count mismatch");
      const plans = [];
      for (const q of warmup.queries)
        if (q.sql && /^\s*SELECT/i.test(q.sql))
          plans.push({
            sql: q.sql,
            args: q.args,
            meta: q.meta,
            plan: (
              await db
                .prepare("EXPLAIN QUERY PLAN " + q.sql)
                .bind(...q.args)
                .all()
            ).results,
          });
      const entry = {
        name: scenario.name,
        path: scenario.path,
        cacheMode: coldReads ? "cold-bypass" : "normal",
        coldMs: warmup.ms,
        coldCacheBypasses: warmup.coldCacheBypasses ?? 0,
        coldRowsRead: warmup.queries.reduce(
          (n, q) => n + (q.meta?.rows_read ?? 0),
          0,
        ),
        plans,
        loads: [],
      };
      stage.scenarios.push(entry);
      for (const concurrency of concurrencyLevels) {
        const observations = [];
        let next = 0;
        const started = performance.now();
        await Promise.all(
          Array.from({ length: Math.min(concurrency, samples) }, async () => {
            while (next++ < samples) {
              try {
                const r = await request(scenario, { cold: coldReads });
                observations.push({
                  ms: r.ms,
                  status: r.status,
                  workerMs: r.workerMs,
                  coldCacheBypasses: r.coldCacheBypasses ?? 0,
                  rowsRead: r.queries.reduce(
                    (n, q) => n + (q.meta?.rows_read ?? 0),
                    0,
                  ),
                  rowsWritten: r.queries.reduce(
                    (n, q) => n + (q.meta?.rows_written ?? 0),
                    0,
                  ),
                  queries: r.queries.length,
                });
              } catch (error) {
                observations.push({
                  ms: null,
                  status: 0,
                  error: String(error),
                });
              }
            }
          }),
        );
        const elapsed = performance.now() - started,
          latencies = observations
            .filter((x) => x.ms !== null)
            .map((x) => x.ms);
        const load = {
          concurrency,
          requests: observations.length,
          errors: observations.filter((x) => x.status !== 200).length,
          elapsedMs: elapsed,
          rps: observations.length / (elapsed / 1000),
          p50: percentile(latencies, 0.5),
          p95: percentile(latencies, 0.95),
          p99: percentile(latencies, 0.99),
          max: latencies.length ? Math.max(...latencies) : null,
          rowsRead: percentile(
            observations.map((x) => x.rowsRead ?? 0),
            0.5,
          ),
          observations,
        };
        entry.loads.push(load);
        await save();
        console.log(
          `${size} ${scenario.name} c=${concurrency} p95=${load.p95?.toFixed(1)}ms reads=${load.rowsRead} errors=${load.errors}`,
        );
        if (load.errors || load.p95 > stopP95Ms) {
          report.stoppedReason = `Stopped read profile at ${size} ${scenario.name} c=${concurrency}: ${load.errors} errors, p95=${load.p95}ms (stop threshold ${stopP95Ms}ms).`;
          await save();
          break volumeLoop;
        }
      }
      await save();
    }
  }
  if (process.env.STRESS_MIXED === "1" || mixedSameCollection) {
    report.mixed = [];
    const mixedObject = mixedSameCollection ? "contacts" : "deals";
    const mixedReadPath = mixedSameCollection
      ? "/api/records/contacts?perPage=25&stage=open&sort=updated_at&order=DESC"
      : "/api/records/contacts?perPage=25";
    // Fixed 80/20 read/write workload; same-collection mode exercises invalidation.
    for (const concurrency of concurrencyLevels) {
      const observations = [];
      let next = 0;
      const started = performance.now();
      const before = Number(
        await db
          .prepare(
            `SELECT count(*) AS n FROM studio_records WHERE tenant_id='900001' AND object_name='${mixedObject}'`,
          )
          .first("n"),
      );
      await Promise.all(
        Array.from(
          { length: Math.min(concurrency, mixedSamples) },
          async () => {
            while (true) {
              const index = next++;
              if (index >= mixedSamples) break;
              const write = index % 5 === 0;
              try {
                const r = await request(
                  write
                    ? {
                        path: `/api/records/${mixedObject}`,
                        method: "POST",
                        body: {
                          name: "Stress " + index,
                          email: "load" + index + "@example.invalid",
                          stage: "open",
                          amount: index,
                          notes: "Synthetic",
                        },
                      }
                    : { path: mixedReadPath },
                  { cold: coldReads },
                );
                observations.push({
                  write,
                  status: r.status,
                  ms: r.ms,
                  rowsRead: r.queries.reduce(
                    (n, q) => n + (q.meta?.rows_read ?? 0),
                    0,
                  ),
                  rowsWritten: r.queries.reduce(
                    (n, q) => n + (q.meta?.rows_written ?? 0),
                    0,
                  ),
                  error: r.status >= 400 ? r.body : undefined,
                });
              } catch (error) {
                observations.push({ write, status: 0, error: String(error) });
              }
            }
          },
        ),
      );
      const elapsedMs = performance.now() - started;
      const after = Number(
        await db
          .prepare(
            `SELECT count(*) AS n FROM studio_records WHERE tenant_id='900001' AND object_name='${mixedObject}'`,
          )
          .first("n"),
      );
      const successes = observations.filter(
        (x) => x.write && x.status === 201,
      ).length;
      if (after - before !== successes)
        throw Error("Write acknowledgement/count mismatch");
      if (mixedSameCollection) {
        const summary = await request(
          {
            path: "/api/records/contacts/summary?group=stage&amountField=amount",
          },
          { cold: coldReads },
        );
        if (summary.status !== 200)
          throw Error(
            `Post-write summary failed: ${JSON.stringify(summary.body)}`,
          );
        const direct = await db
          .prepare(
            `SELECT json_extract(data,'$.stage') AS value,count(*) AS count,
                    COALESCE(sum(CAST(json_extract(data,'$.amount') AS REAL)),0) AS amount
             FROM studio_records WHERE tenant_id='900001' AND object_name='contacts'
               AND deleted_at IS NULL GROUP BY value`,
          )
          .all();
        const normalize = (rows) =>
          rows
            .map((row) => ({
              value: row.value,
              count: Number(row.count),
              amount: Number(row.amount),
            }))
            .sort((a, b) => a.value.localeCompare(b.value));
        if (
          JSON.stringify(normalize(summary.body.data)) !==
          JSON.stringify(normalize(direct.results))
        )
          throw Error("Post-write grouped summary disagrees with direct SQL");
      }
      const errors = observations.filter(
        (x) => x.status !== (x.write ? 201 : 200),
      ).length;
      const load = {
        concurrency,
        requests: observations.length,
        errors,
        elapsedMs,
        rps: observations.length / (elapsedMs / 1000),
        committedWrites: successes,
        readP95: percentile(
          observations.filter((x) => !x.write && x.ms != null).map((x) => x.ms),
          0.95,
        ),
        writeP95: percentile(
          observations.filter((x) => x.write && x.ms != null).map((x) => x.ms),
          0.95,
        ),
        observations,
      };
      report.mixed.push(load);
      await save();
      console.log(
        `Mixed c=${concurrency} readP95=${load.readP95?.toFixed(1)}ms writeP95=${load.writeP95?.toFixed(1)}ms committed=${successes} errors=${errors}`,
      );
    }
    report.integrity = {
      foreignKeyViolations: (await db.prepare("PRAGMA foreign_key_check").all())
        .results,
      recordRows: await db
        .prepare("SELECT count(*) AS n FROM studio_records")
        .first("n"),
      syncRows: await db
        .prepare("SELECT count(*) AS n FROM crm_sync_changes")
        .first("n"),
    };
    if (
      report.integrity.foreignKeyViolations.length ||
      report.integrity.recordRows !== report.integrity.syncRows
    )
      throw Error("Post-load integrity check failed");
  }
  report.hasErrors =
    Boolean(report.stoppedReason) ||
    report.stages.some((s) =>
      s.scenarios.some((s) =>
        s.loads.some((l) => l.errors > 0 || l.requests !== samples),
      ),
    ) ||
    (report.mixed ?? []).some(
      (l) => l.errors > 0 || l.requests !== mixedSamples,
    );
  if (report.hasErrors) process.exitCode = 1;
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(`Results: ${output}`);
} catch (error) {
  report.fatalError = String(error);
  report.hasErrors = true;
  await save();
  throw error;
} finally {
  await mf?.dispose();
  await rm(temp, { recursive: true, force: true });
}
