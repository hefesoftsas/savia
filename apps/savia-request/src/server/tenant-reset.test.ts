import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import requestApp from "./index";
import { getFlow, getVariables, saveFlow } from "./store";
import type { Env } from "./env";

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

const TENANT_A = "agency:101";
const TENANT_B = "agency:202";

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
  await platform.env.DB.exec(
    "DELETE FROM flow_variables; DELETE FROM flows; DELETE FROM flow_versions; DELETE FROM flow_runs; DELETE FROM folders; DELETE FROM installed_bundles; DELETE FROM tenant_flows; DELETE FROM tenant_flow_variables; DELETE FROM tenant_flow_versions; DELETE FROM tenant_flow_runs; DELETE FROM tenant_folders; DELETE FROM tenant_bundles;",
  );
});

afterAll(async () => {
  await platform?.dispose();
});

const baseSteps = [
  {
    id: "s1",
    name: "paso",
    url: "https://global.test/q",
    method: "GET",
    headers: {},
    body: "",
    pre: "",
    post: "",
  },
];

function insertGlobalFlow() {
  return platform.env.DB.prepare("INSERT INTO flows(id,definition) VALUES(?,?)")
    .bind(
      "shared-flow",
      JSON.stringify({
        id: "shared-flow",
        name: "Shared",
        description: "",
        steps: baseSteps,
        input: {},
        variables: [],
        folderPath: "Base",
      }),
    )
    .run();
}

function insertGlobalVariable(key: string, value: string, secret = 0) {
  return platform.env.DB.prepare(
    "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
  )
    .bind("shared-flow", key, value, secret)
    .run();
}

function call(method: string, path: string, body?: unknown, tenant?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (tenant) headers["x-savia-tenant"] = tenant;
  return requestApp.fetch(
    new Request("https://savia-request.internal" + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    platform.env,
  );
}

describe("tenant reset", () => {
  it("reverts a customized flow back to the platform catalog", async () => {
    await insertGlobalFlow();
    await insertGlobalVariable("endpoint", "https://global.test");
    await saveFlow(
      platform.env,
      {
        id: "shared-flow",
        name: "Shared A",
        description: "",
        steps: [
          { ...baseSteps[0], id: "s1", url: "https://a.test/q" },
        ] as typeof baseSteps,
        variables: [],
        input: {},
        folderPath: "A",
      },
      TENANT_A,
    );
    await platform.env.DB.prepare(
      "INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        TENANT_A,
        "shared-flow",
        "endpoint",
        "https://a.test",
        0,
        new Date().toISOString(),
      )
      .run();

    expect(await getFlow(platform.env, "shared-flow", TENANT_A)).toMatchObject({
      name: "Shared A",
      customized: true,
    });
    const summaries = (await (
      await call("GET", "/api/flows", undefined, TENANT_A)
    ).json()) as { id: string; customized: boolean }[];
    expect(summaries.find((flow) => flow.id === "shared-flow")).toMatchObject({
      customized: true,
    });

    const response = await call(
      "POST",
      "/api/flows/shared-flow/reset",
      {},
      TENANT_A,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, reverted: true });

    expect(await getFlow(platform.env, "shared-flow", TENANT_A)).toMatchObject({
      name: "Shared",
      folderPath: "Base",
      customized: false,
    });
    expect(
      (await getVariables(platform.env, "shared-flow", false, TENANT_A)).find(
        (variable) => variable.key === "endpoint",
      ),
    ).toMatchObject({ value: "https://global.test", overridden: false });
    // Other tenants and the platform catalog are untouched.
    expect(await getFlow(platform.env, "shared-flow", TENANT_B)).toMatchObject({
      customized: false,
    });
  });

  it("removes tenant-only flows and reports unchanged for pure globals", async () => {
    await insertGlobalFlow();
    await saveFlow(
      platform.env,
      {
        id: "tenant-only",
        name: "Solo A",
        description: "",
        steps: baseSteps,
        variables: [],
        input: {},
        folderPath: "A",
      },
      TENANT_A,
    );

    expect(
      (await call("POST", "/api/flows/tenant-only/reset", {}, TENANT_A)).status,
    ).toBe(200);
    expect(await getFlow(platform.env, "tenant-only", TENANT_A)).toBeNull();

    const untouched = await call(
      "POST",
      "/api/flows/shared-flow/reset",
      {},
      TENANT_A,
    );
    expect(untouched.status).toBe(200);
    expect(await untouched.json()).toEqual({ ok: true, reverted: false });

    expect(
      (await call("POST", "/api/flows/missing/reset", {}, TENANT_A)).status,
    ).toBe(404);
    expect(
      (await call("POST", "/api/flows/shared-flow/reset", {})).status,
    ).toBe(400);
  });

  it("reverts a single variable override back to the platform default", async () => {
    await insertGlobalFlow();
    await insertGlobalVariable("endpoint", "https://global.test");
    await insertGlobalVariable("timeout", "30");
    await platform.env.DB.prepare(
      "INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        TENANT_A,
        "shared-flow",
        "endpoint",
        "https://a.test",
        0,
        new Date().toISOString(),
      )
      .run();

    const before = await getVariables(
      platform.env,
      "shared-flow",
      false,
      TENANT_A,
    );
    expect(
      before.find((variable) => variable.key === "endpoint"),
    ).toMatchObject({
      value: "https://a.test",
      overridden: true,
    });
    expect(before.find((variable) => variable.key === "timeout")).toMatchObject(
      {
        value: "30",
        overridden: false,
      },
    );

    const response = await call(
      "DELETE",
      "/api/flows/shared-flow/variables/endpoint",
      undefined,
      TENANT_A,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, reverted: true });

    const after = await getVariables(
      platform.env,
      "shared-flow",
      false,
      TENANT_A,
    );
    expect(after.find((variable) => variable.key === "endpoint")).toMatchObject(
      {
        value: "https://global.test",
        overridden: false,
      },
    );

    // Reverting a platform default is a no-op; unknown flows/keys 404.
    const unchanged = await call(
      "DELETE",
      "/api/flows/shared-flow/variables/timeout",
      undefined,
      TENANT_A,
    );
    expect(unchanged.status).toBe(200);
    expect(await unchanged.json()).toEqual({ ok: true, reverted: false });
    expect(
      (
        await call(
          "DELETE",
          "/api/flows/shared-flow/variables/nope",
          undefined,
          TENANT_A,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "DELETE",
          "/api/flows/missing/variables/endpoint",
          undefined,
          TENANT_A,
        )
      ).status,
    ).toBe(404);
    expect(
      (await call("DELETE", "/api/flows/shared-flow/variables/endpoint"))
        .status,
    ).toBe(400);
  });
}, 30_000);
