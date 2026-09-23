import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import requestApp from "./index";
import { getFlow, getVariables } from "./store";
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

function call(method: string, path: string, tenantHeader?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (tenantHeader) headers["x-savia-tenant"] = tenantHeader;
  return requestApp.fetch(
    new Request("https://savia-request.internal" + path, {
      method,
      headers,
      body: JSON.stringify({}),
    }),
    platform.env,
  );
}

async function seedScope(tenant: string) {
  const now = new Date().toISOString();
  const suffix = tenant === TENANT_A ? "a" : "b";
  await platform.env.DB.batch([
    platform.env.DB.prepare(
      "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?)",
    ).bind(
      tenant,
      "flow-a",
      JSON.stringify({ id: "flow-a", name: "A", steps: [], variables: [] }),
      now,
    ),
    platform.env.DB.prepare(
      "INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?)",
    ).bind(tenant, "flow-a", "api_token", "sealed-value", 1, now),
    platform.env.DB.prepare(
      "INSERT INTO tenant_flow_versions(id,tenant_id,flow_id,definition,created_at) VALUES(?,?,?,?,?)",
    ).bind(`v-${suffix}`, tenant, "flow-a", "{}", now),
    platform.env.DB.prepare(
      "INSERT INTO tenant_flow_runs(id,tenant_id,flow_id,version_id,mode,status,created_at,summary) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(`r-${suffix}`, tenant, "flow-a", null, "mock", "success", now, "{}"),
    platform.env.DB.prepare(
      "INSERT INTO tenant_folders(tenant_id,path) VALUES(?,?)",
    ).bind(tenant, "Carpeta"),
    platform.env.DB.prepare(
      "INSERT INTO tenant_bundles(tenant_id,id,version,installed_at) VALUES(?,?,?,?)",
    ).bind(tenant, "insurance-auto-light", "1.1.0", now),
  ]);
}

describe("tenant purge", () => {
  it("removes every overlay row of the tenant and reports counts", async () => {
    await seedScope(TENANT_A);
    await seedScope(TENANT_B);
    await platform.env.DB.prepare(
      "INSERT INTO flows(id,definition) VALUES(?,?)",
    )
      .bind(
        "global",
        JSON.stringify({
          id: "global",
          name: "G",
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
        }),
      )
      .run();

    const response = await call("DELETE", `/api/admin/tenants/${TENANT_A}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tenant: TENANT_A,
      purged: {
        variables: 1,
        versions: 1,
        runs: 1,
        folders: 1,
        bundles: 1,
        flows: 1,
      },
    });

    expect(await getFlow(platform.env, "flow-a", TENANT_A)).toBeNull();
    expect(await getVariables(platform.env, "flow-a", true, TENANT_A)).toEqual(
      [],
    );
    // Other tenant and the platform catalog are untouched.
    expect(await getFlow(platform.env, "flow-a", TENANT_B)).not.toBeNull();
    expect(await getFlow(platform.env, "global", "")).not.toBeNull();
  });

  it("reports zeros for a tenant without overlays", async () => {
    const response = await call("DELETE", `/api/admin/tenants/${TENANT_B}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tenant: TENANT_B,
      purged: {
        variables: 0,
        versions: 0,
        runs: 0,
        folders: 0,
        bundles: 0,
        flows: 0,
      },
    });
  });

  it("refuses invalid tenants and the platform catalog", async () => {
    expect(
      (await call("DELETE", "/api/admin/tenants/agency%2F..%2Fx")).status,
    ).toBe(400);
    // Empty scope never reaches the store: purging "" throws instead.
    const { purgeTenant } = await import("./store");
    await expect(purgeTenant(platform.env, "")).rejects.toThrow();
  });

  it("blocks a scoped caller from purging another scope", async () => {
    await seedScope(TENANT_B);
    const response = await call(
      "DELETE",
      `/api/admin/tenants/${TENANT_B}`,
      TENANT_A,
    );
    expect(response.status).toBe(403);
    expect(await getFlow(platform.env, "flow-a", TENANT_B)).not.toBeNull();
  });

  it("lets a scoped caller purge its own scope", async () => {
    await seedScope(TENANT_A);
    const response = await call(
      "DELETE",
      `/api/admin/tenants/${TENANT_A}`,
      TENANT_A,
    );
    expect(response.status).toBe(200);
    expect(await getFlow(platform.env, "flow-a", TENANT_A)).toBeNull();
  });
});
