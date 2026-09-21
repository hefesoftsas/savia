import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import requestApp from "./index";
import { seal, unseal } from "./store";
import type { Env } from "./env";

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
  await platform.env.DB.exec("DELETE FROM flow_variables; DELETE FROM flows;");
});

afterAll(async () => {
  await platform?.dispose();
});

function insertFlow(id: string, name = id) {
  return platform.env.DB.prepare("INSERT INTO flows(id,definition) VALUES(?,?)")
    .bind(id, JSON.stringify({ id, name, steps: [], variables: [] }))
    .run();
}

function call(method: string, path: string, body?: unknown) {
  return requestApp.fetch(
    new Request("https://savia-request.internal" + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    platform.env,
  );
}

describe("bulk secret transfer", () => {
  it("exports every flow with decrypted secrets in one request", async () => {
    await insertFlow("b-flow", "B");
    await insertFlow("a-flow", "A");
    await insertFlow("empty-flow", "Empty");
    await platform.env.DB.batch([
      platform.env.DB.prepare(
        "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
      ).bind("a-flow", "api_token", await seal(platform.env, "s1"), 1),
      platform.env.DB.prepare(
        "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
      ).bind("a-flow", "endpoint", "https://provider.test", 0),
      platform.env.DB.prepare(
        "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
      ).bind("b-flow", "blank", "", 1),
    ]);

    const response = await call("GET", "/api/variables/export");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      version: number;
      exportedAt: string;
      flows: { flowId: string; variables: unknown[] }[];
    };
    expect(body.version).toBe(1);
    expect(body.exportedAt).toEqual(expect.any(String));
    expect(
      body.flows.find((flow) => flow.flowId === "empty-flow"),
    ).toBeUndefined();
    expect(
      body.flows.filter(
        (flow) => flow.flowId === "a-flow" || flow.flowId === "b-flow",
      ),
    ).toEqual([
      {
        flowId: "a-flow",
        variables: [
          { key: "api_token", value: "s1", secret: true },
          { key: "endpoint", value: "https://provider.test", secret: false },
        ],
      },
      {
        flowId: "b-flow",
        variables: [{ key: "blank", value: "", secret: true }],
      },
    ]);
  });

  it("imports missing values, seals secrets and never deletes", async () => {
    await insertFlow("autos");
    await platform.env.DB.batch([
      platform.env.DB.prepare(
        "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
      ).bind("autos", "api_token", await seal(platform.env, "viejo"), 1),
      platform.env.DB.prepare(
        "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
      ).bind("autos", "endpoint", "https://viejo.test", 0),
    ]);

    const response = await call("POST", "/api/variables/import", {
      version: 1,
      exportedAt: "2026-09-20T00:00:00.000Z",
      flows: [
        {
          flowId: "autos",
          variables: [
            { key: "api_token", value: "nuevo", secret: true },
            { key: "endpoint", value: "", secret: false },
            { key: "extra", value: "https://nuevo.test", secret: false },
          ],
        },
        {
          flowId: "missing",
          variables: [{ key: "x", value: "y", secret: false }],
        },
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        { flowId: "autos", applied: 2, skipped: 1, status: "updated" },
        { flowId: "missing", applied: 0, skipped: 0, status: "unknown" },
      ],
    });

    const rows = await platform.env.DB.prepare(
      "SELECT key,value,secret FROM flow_variables WHERE flow_id=? ORDER BY key",
    )
      .bind("autos")
      .all<{ key: string; value: string; secret: number }>();
    expect(rows.results.map((row) => row.key)).toEqual([
      "api_token",
      "endpoint",
      "extra",
    ]);
    const token = rows.results.find((row) => row.key === "api_token")!;
    expect(token.secret).toBe(1);
    expect(await unseal(platform.env, token.value)).toBe("nuevo");
    expect(rows.results.find((row) => row.key === "endpoint")?.value).toBe(
      "https://viejo.test",
    );
    expect(rows.results.find((row) => row.key === "extra")).toMatchObject({
      value: "https://nuevo.test",
      secret: 0,
    });
  });

  it("rejects invalid payloads before any write", async () => {
    await insertFlow("autos");
    for (const payload of [
      { flows: [] },
      {
        flows: [
          { flowId: "autos", variables: [] },
          { flowId: "autos", variables: [] },
        ],
      },
      {
        flows: [
          {
            flowId: "autos",
            variables: [{ key: "bad key!", value: "x", secret: true }],
          },
        ],
      },
      {
        flows: [
          {
            flowId: "autos",
            variables: [
              { key: "k", value: "1", secret: true },
              { key: "k", value: "2", secret: false },
            ],
          },
        ],
      },
    ]) {
      const response = await call("POST", "/api/variables/import", payload);
      expect(response.status).toBe(400);
    }
    expect(
      await platform.env.DB.prepare(
        "SELECT count(*) AS n FROM flow_variables",
      ).first("n"),
    ).toBe(0);
  });
});
