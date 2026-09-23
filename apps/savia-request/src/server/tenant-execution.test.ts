import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { execute } from "./runner";
import { getFlow, getVariables, seal } from "./store";
import type { Env } from "./env";

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

const TENANT_A = "agency:101";

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
    "DELETE FROM flow_variables; DELETE FROM flows; DELETE FROM flow_versions; DELETE FROM flow_runs; DELETE FROM folders; DELETE FROM installed_bundles; DELETE FROM tenant_flows; DELETE FROM tenant_flow_variables; DELETE FROM tenant_flow_versions; DELETE FROM tenant_flow_runs; DELETE FROM tenant_folders; DELETE FROM tenant_bundles; DELETE FROM bundle_flow_state; DELETE FROM savia_request_audit;",
  );
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await platform?.dispose();
});

async function seedSecretFlow() {
  await platform.env.DB.prepare("INSERT INTO flows(id,definition) VALUES(?,?)")
    .bind(
      "secret-flow",
      JSON.stringify({
        id: "secret-flow",
        name: "Secret flow",
        description: "",
        steps: [
          {
            id: "s1",
            name: "paso",
            url: "https://provider.test/q",
            method: "GET",
            headers: { "x-api-key": "{{api_key}}" },
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
  await platform.env.DB.prepare(
    "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
  )
    .bind("secret-flow", "api_key", await seal(platform.env, "topsecret"), 1)
    .run();
}

describe("tenant execution secrets", () => {
  it("uses platform secrets live in tenant scope and redacts them", async () => {
    await seedSecretFlow();
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { headers?: unknown }) => {
        seen.push({
          url: String(url),
          headers: { ...(init?.headers as Record<string, string>) },
        });
        return Response.json({ echo: "topsecret", ok: true });
      }),
    );
    const flow = (await getFlow(platform.env, "secret-flow", TENANT_A))!;
    const run = await execute(platform.env, flow, {}, "live", null, TENANT_A);

    expect(run.status).toBe("success");
    // The platform secret reached the provider in tenant scope.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers["x-api-key"]).toBe("topsecret");
    // ...but never leaks into persisted traces or results.
    expect(JSON.stringify(run.steps)).not.toContain("topsecret");
    expect(JSON.stringify(run.result)).not.toContain("topsecret");
  }, 30_000);

  it("keeps masking base secrets on reads while execution decrypts", async () => {
    await seedSecretFlow();
    const masked = await getVariables(
      platform.env,
      "secret-flow",
      true,
      TENANT_A,
    );
    expect(masked).toContainEqual({
      key: "api_key",
      secret: true,
      configured: true,
      overridden: false,
      value: "",
    });
    const executed = await getVariables(
      platform.env,
      "secret-flow",
      true,
      TENANT_A,
      true,
    );
    expect(executed).toContainEqual({
      key: "api_key",
      secret: true,
      configured: true,
      overridden: false,
      value: "topsecret",
    });
  }, 30_000);
});
