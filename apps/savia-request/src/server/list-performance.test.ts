import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import {
  catalogFingerprint,
  getFlow,
  listScopedFlows,
  resetSeedCache,
  seedOnce,
} from "./store";
import type { Env } from "./env";

/**
 * Operaciones de base de datos antes → después (catálogo de 24 flows).
 *
 * - `seedOnce` por petición: 24 INSERTs → 1 SELECT de sonda (reinserta ante
 *   fingerprint nuevo o tabla vacía).
 * - `listScopedFlows` tenant con N globals sin overlays: 2 + 2·N (50)
 *   → 2 consultas conjuntas. Plataforma: 1 + N (25) → 1.
 * El listado ya no crece linealmente con cada flow.
 */

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

async function applyMigrations() {
  for (const migration of readdirSync("migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    const statements = readFileSync("migrations/" + migration, "utf8")
      .split(";")
      .filter((statement) => statement.trim());
    for (const statement of statements)
      await platform.env.DB.exec(statement + ";");
  }
}

function flowDefinition(id: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id,
    name: id,
    description: "",
    steps: [
      {
        id: "s1",
        name: "paso",
        url: "https://provider.test/q",
        method: "GET",
        headers: {},
        body: "",
        pre: "",
        post: "",
      },
    ],
    input: {},
    variables: [],
    folderPath: "Base",
    ...extra,
  });
}

function countingEnv() {
  let prepares = 0;
  const db = new Proxy(platform.env.DB, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (...args: [string]) => {
          prepares += 1;
          return (
            Reflect.get(target, prop, receiver) as (...a: [string]) => unknown
          )(...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    env: { ...platform.env, DB: db } as Env,
    count: () => prepares,
  };
}

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  await applyMigrations();
  (platform.env as unknown as Record<string, unknown>).ENCRYPTION_KEY =
    Buffer.alloc(32, 7).toString("base64");
});

beforeEach(async () => {
  resetSeedCache();
  await platform.env.DB.exec(
    "DELETE FROM flow_variables; DELETE FROM flows; DELETE FROM tenant_flows; DELETE FROM tenant_flow_variables; DELETE FROM tenant_flow_versions; DELETE FROM flow_versions; DELETE FROM flow_runs; DELETE FROM tenant_flow_runs; DELETE FROM folders; DELETE FROM tenant_folders;",
  );
});

afterAll(async () => {
  await platform?.dispose();
});

describe("listScopedFlows batched", () => {
  it("resolves overlay precedence, deletions and stable order with few queries", async () => {
    const ids = ["flow-a", "flow-b", "flow-c", "flow-d", "flow-e", "flow-f"];
    for (const id of ids) {
      await platform.env.DB.prepare(
        "INSERT INTO flows(id,definition) VALUES(?,?)",
      )
        .bind(id, flowDefinition(id))
        .run();
    }
    // Overlay del tenant: personaliza flow-b y elimina flow-c.
    await platform.env.DB.prepare(
      "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?)",
    )
      .bind(
        "agency:101",
        "flow-b",
        flowDefinition("flow-b", { name: "flow-b custom" }),
        new Date().toISOString(),
      )
      .run();
    await platform.env.DB.prepare(
      "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?)",
    )
      .bind(
        "agency:101",
        "flow-c",
        flowDefinition("flow-c", { deleted: true }),
        new Date().toISOString(),
      )
      .run();
    // Flow solo del tenant.
    await platform.env.DB.prepare(
      "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?)",
    )
      .bind(
        "agency:101",
        "flow-tenant-only",
        flowDefinition("flow-tenant-only"),
        new Date().toISOString(),
      )
      .run();

    const { env, count } = countingEnv();
    const flows = await listScopedFlows(env, "agency:101");
    const queries = count();

    // flow-c eliminado, orden estable, precedencia del overlay.
    expect(flows.map((flow) => flow.id)).toEqual([
      "flow-a",
      "flow-b",
      "flow-d",
      "flow-e",
      "flow-f",
      "flow-tenant-only",
    ]);
    expect(flows.find((flow) => flow.id === "flow-b")?.customized).toBe(true);
    expect(flows.find((flow) => flow.id === "flow-b")?.name).toBe(
      "flow-b custom",
    );
    expect(flows.find((flow) => flow.id === "flow-a")?.customized).toBe(false);
    // No expone variables ni secretos adicionales: misma forma que getFlow.
    for (const flow of flows) {
      const single = await getFlow(platform.env, flow.id, "agency:101");
      expect(flow).toEqual(single);
    }
    // El listado no crece linealmente con cada flow: 2 consultas conjuntas
    // en lugar de 2 por flow (+ listado de IDs).
    expect(queries).toBeLessThanOrEqual(3);

    // Plataforma: una sola consulta conjunta.
    const platformCounted = countingEnv();
    const platformFlows = await listScopedFlows(platformCounted.env, "");
    expect(platformFlows.map((flow) => flow.id)).toEqual(ids);
    expect(platformCounted.count()).toBeLessThanOrEqual(2);
  });
});

describe("seedOnce", () => {
  it("seeds the catalog once and incorporates new definitions", async () => {
    const first = countingEnv();
    await seedOnce(first.env);
    const firstQueries = first.count();
    expect(firstQueries).toBeGreaterThan(1);
    const listed = await listScopedFlows(platform.env, "");
    expect(listed.length).toBeGreaterThan(5);
    expect(catalogFingerprint()).toContain("dane-city-lookup");

    // Segunda petición: evita el trabajo repetido (una sola lectura ligera).
    const second = countingEnv();
    await seedOnce(second.env);
    expect(second.count()).toBeLessThanOrEqual(2);
    expect(await listScopedFlows(platform.env, "")).toEqual(listed);

    // Un despliegue con una definición nueva la incorpora sin borrar nada.
    const missing = listed[0]!.id;
    await platform.env.DB.prepare("DELETE FROM flows WHERE id=?")
      .bind(missing)
      .run();
    expect(await getFlow(platform.env, missing, "")).toBeNull();
    resetSeedCache();
    await seedOnce(platform.env);
    expect(await getFlow(platform.env, missing, "")).not.toBeNull();
  });
});
