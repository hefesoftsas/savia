import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import requestApp from "./index";
import { listAuditEvents } from "./store";
import type { Env } from "./env";

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

const TENANT_A = "agency:101";
const TENANT_B = "agency:202";
const ACTOR = "admin-1";

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
});

afterAll(async () => {
  await platform?.dispose();
});

const flowBody = {
  id: "audit-flow",
  name: "Audit flow",
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
};

function call(
  method: string,
  path: string,
  body?: unknown,
  tenant?: string,
  actor = ACTOR,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-savia-actor": actor,
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

describe("audit trail", () => {
  it("records mutations and secret reveals with attribution, never values", async () => {
    expect(
      await call("PUT", "/api/flows/audit-flow", flowBody, TENANT_A),
    ).toMatchObject({ status: 200 });
    expect(
      await call(
        "PUT",
        "/api/flows/audit-flow/variables",
        [{ key: "api_token", value: "s3cr3t", secret: true }],
        TENANT_A,
      ),
    ).toMatchObject({ status: 200 });
    const revealed = await call(
      "POST",
      "/api/flows/audit-flow/variables/reveal",
      { key: "api_token" },
      TENANT_A,
    );
    expect(revealed.status).toBe(200);
    expect(await revealed.json()).toEqual({ value: "s3cr3t" });
    expect(
      await call("POST", "/api/flows/audit-flow/publish", {}, TENANT_A),
    ).toMatchObject({ status: 200 });

    const { events } = await listAuditEvents(platform.env, TENANT_A, {});
    expect(events).toHaveLength(4);
    expect(events.map((event) => event.action).sort()).toEqual(
      ["flow.publish", "flow.save", "variable.reveal", "variables.save"].sort(),
    );
    for (const event of events) {
      expect(event).toMatchObject({ tenant: TENANT_A, actor: ACTOR });
      expect(event.flowId).toBe("audit-flow");
    }
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("s3cr3t");
    expect(
      events.find((event) => event.action === "variable.reveal"),
    ).toMatchObject({
      detail: { key: "api_token" },
    });
  }, 30_000);

  it("isolates scopes and paginates newest-first", async () => {
    await call("PUT", "/api/flows/audit-flow", flowBody, TENANT_A);
    await call(
      "PUT",
      "/api/flows/audit-flow/variables",
      [{ key: "endpoint", value: "https://a.test", secret: false }],
      TENANT_A,
    );
    await call("PUT", "/api/flows/audit-flow", flowBody, TENANT_B);
    await call("PUT", "/api/flows/audit-flow", flowBody);

    const first = (await (
      await call("GET", "/api/audit?limit=1", undefined, TENANT_A)
    ).json()) as { events: { action: string }[]; nextCursor: string | null };
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({ action: "variables.save" });
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = (await (
      await call(
        "GET",
        `/api/audit?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
        undefined,
        TENANT_A,
      )
    ).json()) as {
      events: { action: string }[];
      nextCursor: string | null;
    };
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({ action: "flow.save" });
    expect(second.nextCursor).toBeNull();

    // Other scopes are invisible here.
    expect(
      (
        (await (
          await call("GET", "/api/audit", undefined, TENANT_B)
        ).json()) as {
          events: unknown[];
        }
      ).events,
    ).toHaveLength(1);
    expect(
      (
        (await (await call("GET", "/api/audit")).json()) as {
          events: unknown[];
        }
      ).events,
    ).toHaveLength(1);

    expect((await call("GET", "/api/audit?limit=0")).status).toBe(400);
    expect((await call("GET", "/api/audit?limit=500")).status).toBe(400);
  }, 30_000);

  it("survives tenant purges for post-deletion forensics", async () => {
    await call("PUT", "/api/flows/audit-flow", flowBody, TENANT_A);
    const purged = await call("DELETE", `/api/admin/tenants/${TENANT_A}`);
    expect(purged.status).toBe(200);

    const { events } = await listAuditEvents(platform.env, TENANT_A, {});
    expect(events.map((event) => event.action).sort()).toEqual(
      ["flow.save", "tenant.purge"].sort(),
    );
    expect(events[0]).toMatchObject({
      tenant: TENANT_A,
      actor: ACTOR,
      detail: { purged: expect.any(Object) },
    });
  }, 30_000);
});
