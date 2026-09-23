import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import requestApp from "./index";
import {
  ensureInsuranceAutoLightBundle,
  getFlow,
  getVariables,
  saveFlow,
  saveVariables,
} from "./store";
import type { Env } from "./env";
import { seal } from "./store";

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
    "DELETE FROM flow_variables; DELETE FROM flows; DELETE FROM tenant_flows; DELETE FROM tenant_flow_variables; DELETE FROM tenant_flow_versions; DELETE FROM tenant_flow_runs; DELETE FROM flow_versions; DELETE FROM flow_runs; DELETE FROM folders; DELETE FROM tenant_folders;",
  );
});

afterAll(async () => {
  await platform?.dispose();
});

function insertGlobalFlow(id: string, name = id, folderPath = "Base") {
  return platform.env.DB.prepare("INSERT INTO flows(id,definition) VALUES(?,?)")
    .bind(
      id,
      JSON.stringify({
        id,
        name,
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
        folderPath,
      }),
    )
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

describe("tenant scope", () => {
  it("rejects invalid tenant ids before touching storage", async () => {
    const response = await call("GET", "/api/flows", undefined, "agency/../x");
    expect(response.status).toBe(400);
  });

  it("keeps tenant definitions isolated with fallback to the platform catalog", async () => {
    await insertGlobalFlow("shared-flow", "Shared");
    // Tenant B sees the global definition.
    expect(await getFlow(platform.env, "shared-flow", TENANT_B)).toMatchObject({
      name: "Shared",
    });
    // Tenant A overrides only its own copy.
    await saveFlow(
      platform.env,
      {
        id: "shared-flow",
        name: "Shared A",
        description: "",
        steps: [
          {
            id: "s1",
            name: "paso",
            url: "https://a.test/q",
            method: "GET",
            headers: {},
            body: "",
            pre: "",
            post: "",
          },
        ],
        variables: [],
        input: {},
        folderPath: "A",
      },
      TENANT_A,
    );
    expect(await getFlow(platform.env, "shared-flow", TENANT_A)).toMatchObject({
      name: "Shared A",
      folderPath: "A",
    });
    expect(await getFlow(platform.env, "shared-flow", TENANT_B)).toMatchObject({
      name: "Shared",
    });
    expect(await getFlow(platform.env, "shared-flow", "")).toMatchObject({
      name: "Shared",
    });
    // Tenant A hides the flow without affecting the platform or tenant B.
    expect(
      await call("DELETE", "/api/flows/shared-flow", {}, TENANT_A),
    ).toMatchObject({ status: 200 });
    expect(await getFlow(platform.env, "shared-flow", TENANT_A)).toBeNull();
    expect(await getFlow(platform.env, "shared-flow", TENANT_B)).not.toBeNull();
    expect(await getFlow(platform.env, "shared-flow", "")).not.toBeNull();
    const listA = (await (
      await call("GET", "/api/flows", undefined, TENANT_A)
    ).json()) as { id: string }[];
    expect(listA.map((flow) => flow.id)).not.toContain("shared-flow");
  });

  it("merges variables per tenant without leaking platform secrets", async () => {
    await insertGlobalFlow("vars-flow");
    await platform.env.DB.batch([
      platform.env.DB.prepare(
        "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
      ).bind("vars-flow", "endpoint", "https://global.test", 0),
      platform.env.DB.prepare(
        "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
      ).bind(
        "vars-flow",
        "api_token",
        await seal(platform.env, "global-s3cr3t"),
        1,
      ),
    ]);
    // Tenant sees the endpoint default but never the platform secret value.
    const masked = await getVariables(
      platform.env,
      "vars-flow",
      false,
      TENANT_A,
    );
    expect(masked).toContainEqual({
      key: "endpoint",
      secret: false,
      configured: true,
      overridden: false,
      value: "https://global.test",
    });
    expect(masked).toContainEqual({
      key: "api_token",
      secret: true,
      configured: true,
      overridden: false,
      value: "",
    });
    const revealed = await getVariables(
      platform.env,
      "vars-flow",
      true,
      TENANT_A,
    );
    expect(revealed.find((v) => v.key === "api_token")).toMatchObject({
      value: "",
    });
    // Reveal endpoint also stays tenant-scoped: platform secret unreachable.
    expect(
      await (
        await call(
          "POST",
          "/api/flows/vars-flow/variables/reveal",
          { key: "api_token" },
          TENANT_A,
        )
      ).json(),
    ).toEqual({ value: "" });
    // Tenant configures its own values; an empty secret keeps the fallback.
    await saveVariables(
      platform.env,
      "vars-flow",
      [
        { key: "endpoint", value: "https://a.test", secret: false },
        { key: "api_token", value: "tenant-s3cr3t", secret: true },
      ],
      TENANT_A,
    );
    const effective = await getVariables(
      platform.env,
      "vars-flow",
      true,
      TENANT_A,
    );
    expect(effective.find((v) => v.key === "endpoint")).toMatchObject({
      value: "https://a.test",
    });
    expect(effective.find((v) => v.key === "api_token")).toMatchObject({
      value: "tenant-s3cr3t",
    });
    // Other tenant and platform are unaffected.
    expect(
      (await getVariables(platform.env, "vars-flow", true, TENANT_B)).find(
        (v) => v.key === "endpoint",
      ),
    ).toMatchObject({ value: "https://global.test" });
    expect(
      (await getVariables(platform.env, "vars-flow", true, "")).find(
        (v) => v.key === "api_token",
      ),
    ).toMatchObject({ value: "global-s3cr3t" });
    // Saving a masked secret back does not create an empty override.
    await saveVariables(
      platform.env,
      "vars-flow",
      [
        { key: "endpoint", value: "https://b.test", secret: false },
        { key: "api_token", value: "", secret: true },
      ],
      TENANT_B,
    );
    const bPrivate = await getVariables(
      platform.env,
      "vars-flow",
      true,
      TENANT_B,
    );
    expect(bPrivate.find((v) => v.key === "endpoint")).toMatchObject({
      value: "https://b.test",
    });
    expect(bPrivate.find((v) => v.key === "api_token")).toMatchObject({
      value: "",
    });
    const overlayRows = await platform.env.DB.prepare(
      "SELECT key FROM tenant_flow_variables WHERE tenant_id=? AND flow_id=? ORDER BY key",
    )
      .bind(TENANT_B, "vars-flow")
      .all<{ key: string }>();
    expect(overlayRows.results.map((row) => row.key)).toEqual(["endpoint"]);
  });

  it("isolates versions and runs per tenant with platform fallback", async () => {
    await insertGlobalFlow("versioned-flow");
    const published = await (
      await call("POST", "/api/flows/versioned-flow/publish", {}, TENANT_A)
    ).json<{ id: string }>();
    expect(published.id).toEqual(expect.any(String));
    // Tenant run history does not leak into the platform scope and vice versa.
    const runResponse = await call(
      "POST",
      "/api/flows/versioned-flow/runs",
      { mode: "mock", input: {} },
      TENANT_A,
    );
    expect(runResponse.status).toBe(200);
    expect(
      (await (
        await call("GET", "/api/flows/versioned-flow/runs", undefined, TENANT_A)
      ).json()) as unknown[],
    ).toHaveLength(1);
    expect(
      (await (
        await call("GET", "/api/flows/versioned-flow/runs")
      ).json()) as unknown[],
    ).toHaveLength(0);
    // Published v1 execution prefers the tenant version.
    const v1 = await call(
      "POST",
      "/v1/flows/versioned-flow/runs",
      { mode: "mock", input: {} },
      TENANT_A,
    );
    expect(v1.status).toBe(200);
    // Tenant B without its own version falls back to the platform version.
    await call("POST", "/api/flows/versioned-flow/publish", {});
    const fallback = await call(
      "POST",
      "/v1/flows/versioned-flow/runs",
      { mode: "mock", input: {} },
      TENANT_B,
    );
    expect(fallback.status).toBe(200);
  });

  it("unions folders across scopes and deletes only in scope", async () => {
    await call("POST", "/api/folders", { path: "Global" });
    await call("POST", "/api/folders", { path: "Solo A" }, TENANT_A);
    const foldersA = (await (
      await call("GET", "/api/folders", undefined, TENANT_A)
    ).json()) as string[];
    expect(foldersA).toEqual(expect.arrayContaining(["Global", "Solo A"]));
    const foldersB = (await (
      await call("GET", "/api/folders", undefined, TENANT_B)
    ).json()) as string[];
    expect(foldersB).toContain("Global");
    expect(foldersB).not.toContain("Solo A");
    await call("DELETE", "/api/folders", { path: "Solo A" }, TENANT_A);
    expect(
      (await (
        await call("GET", "/api/folders", undefined, TENANT_A)
      ).json()) as string[],
    ).not.toContain("Solo A");
    expect(
      (await (await call("GET", "/api/folders")).json()) as string[],
    ).toContain("Global");
  });

  it("installs the insurance bundle per tenant without touching globals", async () => {
    const installed = await ensureInsuranceAutoLightBundle(
      platform.env,
      TENANT_A,
    );
    expect(installed.flowIds).toContain("sura-autos-provider");
    // Global catalog untouched until the platform itself installs.
    expect(await getFlow(platform.env, "sura-autos-provider", "")).toBeNull();
    expect(
      await getFlow(platform.env, "sura-autos-provider", TENANT_A),
    ).not.toBeNull();
    expect(
      await getFlow(platform.env, "sura-autos-provider", TENANT_B),
    ).toBeNull();
    const bundleRow = await platform.env.DB.prepare(
      "SELECT version FROM tenant_bundles WHERE tenant_id=? AND id=?",
    )
      .bind(TENANT_A, "insurance-auto-light")
      .first<{ version: string }>();
    expect(bundleRow).toMatchObject({ version: "1.1.0" });
  }, 30_000);

  it("exports only the requesting scope", async () => {
    await insertGlobalFlow("export-flow");
    await saveVariables(
      platform.env,
      "export-flow",
      [{ key: "endpoint", value: "https://a.test", secret: false }],
      TENANT_A,
    );
    const body = (await (
      await call("GET", "/api/variables/export", undefined, TENANT_A)
    ).json()) as { tenant: string; flows: { flowId: string }[] };
    expect(body.tenant).toBe(TENANT_A);
    expect(body.flows.map((flow) => flow.flowId)).toContain("export-flow");
    const platformBody = (await (
      await call("GET", "/api/variables/export")
    ).json()) as { flows: { flowId: string }[] };
    expect(platformBody.flows.map((flow) => flow.flowId)).not.toContain(
      "export-flow",
    );
  }, 30_000);
}, 30_000);
