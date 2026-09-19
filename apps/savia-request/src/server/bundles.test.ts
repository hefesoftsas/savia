import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import requestApp from "./index";
import * as store from "./store";
import { execute } from "./runner";
import { demoInput } from "./mock";
import type { Env } from "./env";

const ensureInsuranceAutoLightBundle = (
  store as unknown as {
    ensureInsuranceAutoLightBundle?: (
      env: Env,
    ) => Promise<{ id: string; version: string; flowIds: string[] }>;
  }
).ensureInsuranceAutoLightBundle;

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<Env>>
>;

async function applyMigrations() {
  for (const migration of readdirSync("migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    const statements = readFileSync("migrations/" + migration, "utf8")
      .split(";")
      .filter((statement) => statement.trim());
    for (const statement of statements) await platform.env.DB.exec(statement + ";");
  }
}

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  await applyMigrations();
});

beforeEach(async () => {
  await platform.env.DB.exec("DELETE FROM flow_variables; DELETE FROM flows;");
  await platform.env.DB
    .exec("DELETE FROM installed_bundles;")
    .catch(() => undefined);
});

afterAll(async () => {
  await platform?.dispose();
});

describe("insurance auto-light bundle", () => {
  it("installs all flows while preserving existing secret variables", async () => {
    expect(ensureInsuranceAutoLightBundle).toEqual(expect.any(Function));
    await platform.env.DB
      .prepare(
        "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
      )
      .bind("sura-autos-provider", "sura_api_key", "existing-sealed-value", 1)
      .run();

    const installed = await ensureInsuranceAutoLightBundle?.(platform.env);
    const flows = await platform.env.DB
      .prepare(
        "SELECT count(*) AS total FROM flows WHERE json_extract(definition,'$.folderPath') LIKE ?",
      )
      .bind("06-Cotizaciones/Autos-livianos/%")
      .first<{ total: number }>();
    const variable = await platform.env.DB
      .prepare("SELECT value,secret FROM flow_variables WHERE flow_id=? AND key=?")
      .bind("sura-autos-provider", "sura_api_key")
      .first<{ value: string; secret: number }>();

    expect(installed).toMatchObject({
      id: "insurance-auto-light",
      version: "1.1.0",
      flowIds: expect.arrayContaining(["sura-autos-provider"]),
    });
    expect(flows?.total).toBe(22);
    expect(variable).toEqual({ value: "existing-sealed-value", secret: 1 });
  });

  it("ensures the fixed bundle endpoint repeatedly", async () => {
    const run = () =>
      requestApp.fetch(
        new Request(
          "https://savia-request.internal/api/bundles/insurance-auto-light/ensure",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          },
        ),
        platform.env,
      );

    expect((await run()).status).toBe(200);
    expect((await run()).status).toBe(200);
    const installed = await platform.env.DB
      .prepare("SELECT version FROM installed_bundles WHERE id=?")
      .bind("insurance-auto-light")
      .first<{ version: string }>();
    expect(installed).toEqual({ version: "1.1.0" });
  });

  it("simulates every installed quote flow for a comparison", async () => {
    await ensureInsuranceAutoLightBundle?.(platform.env);
    const flowRows = await platform.env.DB
      .prepare("SELECT id FROM flows ORDER BY id")
      .all<{ id: string }>();
    const flows = await Promise.all(
      flowRows.results.map((row) => store.getFlow(platform.env, row.id)),
    );
    const quoteFlows = flows.filter(
      (flow): flow is NonNullable<typeof flow> =>
        flow !== null && flow.kind !== "lookup" && flow.kind !== "auth",
    );

    expect(quoteFlows).toHaveLength(19);
    const runs = await Promise.all(
      quoteFlows.map((flow) =>
        execute(
          platform.env,
          flow,
          flow.id.startsWith("sbs-") ? demoInput : {},
          "mock",
          null,
        ),
      ),
    );

    expect(runs).toHaveLength(19);
    for (const run of runs) {
      expect(run.status, `${run.flowId}: ${run.error ?? "sin detalle"}`).toBe(
        "success",
      );
      expect(run.result).toMatchObject({
        quoteNumber: expect.any(String),
        premiumTotal: expect.any(String),
        currency: "COP",
        simulated: true,
      });
    }
  }, 30_000);
}, 30_000);

it("installs, documents and executes the DANE reference flow", async () => {
  const response = await requestApp.request('https://savia-request.internal/api/openapi.json', {}, platform.env);
  const doc = await response.json() as any;
  const body = doc.paths['/api/flows/dane-city-lookup/runs'].post.requestBody.content['application/json'];
  expect(body.schema.properties.mode).toMatchObject({ default: 'live', enum: ['live'] });
  expect(body.examples.simulado).toBeUndefined();
  expect(doc.paths['/api/lookups/dane'].get.operationId).toBe('lookupDaneCity');
  const flow = await store.getFlow(platform.env, 'dane-city-lookup');
  expect(flow?.folderPath).toBe('Referencias/Colombia');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ cod_mpio: '11001', nom_mpio: 'BOGOTÁ, D.C.', dpto: 'BOGOTÁ, D.C.' }])));
  try {
    const run = await execute(platform.env, flow!, { city: 'Bogota', department: '' }, 'live', null);
    expect(run).toMatchObject({ status: 'success', result: { status: 'matched', matches: [{ code: '11001' }] } });
  } finally { vi.unstubAllGlobals(); }
});

