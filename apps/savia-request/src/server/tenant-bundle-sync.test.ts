import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import requestApp from "./index";
import {
  bundleContentHash,
  bundleStatus,
  ensureInsuranceAutoLightBundle,
  getFlow,
  getVariables,
} from "./store";
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
    "DELETE FROM flow_variables; DELETE FROM flows; DELETE FROM flow_versions; DELETE FROM flow_runs; DELETE FROM folders; DELETE FROM installed_bundles; DELETE FROM tenant_flows; DELETE FROM tenant_flow_variables; DELETE FROM tenant_flow_versions; DELETE FROM tenant_flow_runs; DELETE FROM tenant_folders; DELETE FROM tenant_bundles; DELETE FROM bundle_flow_state;",
  );
});

afterAll(async () => {
  await platform?.dispose();
});

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

async function bundleFlowId(): Promise<string> {
  const installed = await ensureInsuranceAutoLightBundle(platform.env);
  const flowId = installed.flowIds.find((id) => id === "sura-autos-provider")!;
  return flowId;
}

/**
 * Rewrites a stored definition and backdates its provenance so the scope
 * looks like a pristine install of an older bundle version.
 */
async function backdateFlow(
  flowId: string,
  { tenant = "", folderPath }: { tenant?: string; folderPath?: string } = {},
) {
  const flow = (await getFlow(platform.env, flowId, tenant))!;
  const aged = {
    ...flow,
    variables: [],
    description: `${flow.description} [v0]`,
    ...(folderPath === undefined ? {} : { folderPath }),
  };
  const now = new Date().toISOString();
  if (!tenant) {
    await platform.env.DB.prepare(
      "INSERT INTO flows(id,definition) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition",
    )
      .bind(flowId, JSON.stringify(aged))
      .run();
  } else {
    await platform.env.DB.prepare(
      "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,flow_id) DO UPDATE SET definition=excluded.definition,updated_at=excluded.updated_at",
    )
      .bind(tenant, flowId, JSON.stringify(aged), now)
      .run();
  }
  await platform.env.DB.prepare(
    "INSERT INTO bundle_flow_state(scope,flow_id,bundle_version,content_hash,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(scope,flow_id) DO UPDATE SET bundle_version=excluded.bundle_version,content_hash=excluded.content_hash,updated_at=excluded.updated_at",
  )
    .bind(tenant, flowId, "0.0.1", bundleContentHash(aged), now)
    .run();
}

describe("bundle drift status", () => {
  it("reports current flows after installing", async () => {
    const flowId = await bundleFlowId();
    const status = await bundleStatus(platform.env, "");
    expect(status).toMatchObject({
      id: "insurance-auto-light",
      currentVersion: "1.1.0",
      installedVersion: "1.1.0",
      updateAvailable: false,
    });
    expect(status.flows.find((flow) => flow.flowId === flowId)).toMatchObject({
      state: "current",
    });
    expect(status.summary.current).toBe(status.flows.length);

    const response = await call(
      "GET",
      "/api/bundles/insurance-auto-light/status",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "insurance-auto-light",
      updateAvailable: false,
    });
  }, 30_000);

  it("distinguishes outdated installs from customizations", async () => {
    const flowId = await bundleFlowId();
    // Pristine older install.
    await backdateFlow(flowId);
    // Genuine customization (provenance still points at the bundle).
    const other = (await bundleStatus(platform.env, "")).flows.find(
      (flow) => flow.flowId !== flowId && flow.state === "current",
    )!.flowId;
    const customized = (await getFlow(platform.env, other, ""))!;
    await platform.env.DB.prepare(
      "INSERT INTO flows(id,definition) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition",
    )
      .bind(
        other,
        JSON.stringify({ ...customized, variables: [], name: "Mío" }),
      )
      .run();

    const status = await bundleStatus(platform.env, "");
    expect(status.flows.find((flow) => flow.flowId === flowId)).toMatchObject({
      state: "outdated",
    });
    expect(status.flows.find((flow) => flow.flowId === other)).toMatchObject({
      state: "customized",
    });
    expect(status.updateAvailable).toBe(true);
    expect(status.summary).toMatchObject({ outdated: 1, customized: 1 });
  }, 30_000);

  it("scopes status per tenant without touching globals", async () => {
    const flowId = await bundleFlowId();
    await ensureInsuranceAutoLightBundle(platform.env, TENANT_A);
    await backdateFlow(flowId, { tenant: TENANT_A });

    const tenant = await bundleStatus(platform.env, TENANT_A);
    expect(tenant.flows.find((flow) => flow.flowId === flowId)).toMatchObject({
      state: "outdated",
    });
    expect(tenant.installedVersion).toBe("1.1.0");

    const platformStatus = await bundleStatus(platform.env, "");
    expect(
      platformStatus.flows.find((flow) => flow.flowId === flowId),
    ).toMatchObject({ state: "current" });
  }, 30_000);
});

describe("bundle safe sync", () => {
  it("updates outdated flows, preserves variables and folders", async () => {
    const flowId = await bundleFlowId();
    await backdateFlow(flowId, { folderPath: "Mía" });
    // Configured values must survive the sync.
    await platform.env.DB.prepare(
      "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?) ON CONFLICT(flow_id,key) DO UPDATE SET value=excluded.value",
    )
      .bind(flowId, "endpoint", "https://mia.test", 0)
      .run();

    const response = await call(
      "POST",
      "/api/bundles/insurance-auto-light/sync",
      {},
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      updated: string[];
      skippedCustomized: string[];
      variablesAdded: number;
    };
    expect(result.updated).toContain(flowId);
    expect(result.skippedCustomized).toEqual([]);

    const after = (await getFlow(platform.env, flowId, ""))!;
    expect(after.description).not.toContain("[v0]");
    expect(after.folderPath).toBe("Mía");
    const variables = await getVariables(platform.env, flowId, false, "");
    expect(
      variables.find((variable) => variable.key === "endpoint")?.value,
    ).toBe("https://mia.test");
    expect(await bundleStatus(platform.env, "")).toMatchObject({
      updateAvailable: false,
    });
  }, 30_000);

  it("skips customized and hidden flows unless forced", async () => {
    const flowId = await bundleFlowId();
    const customized = (await getFlow(platform.env, flowId, ""))!;
    await platform.env.DB.prepare(
      "INSERT INTO flows(id,definition) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition",
    )
      .bind(
        flowId,
        JSON.stringify({ ...customized, variables: [], name: "Mío" }),
      )
      .run();
    const hiddenId = (await bundleStatus(platform.env, "")).flows.find(
      (flow) => flow.flowId !== flowId && flow.state === "current",
    )!.flowId;
    await call("DELETE", `/api/flows/${hiddenId}`, {});

    const skipped = (await (
      await call("POST", "/api/bundles/insurance-auto-light/sync", {})
    ).json()) as {
      updated: string[];
      skippedCustomized: string[];
      hidden: string[];
    };
    expect(skipped.updated).not.toContain(flowId);
    expect(skipped.skippedCustomized).toContain(flowId);
    expect(skipped.hidden).toContain(hiddenId);
    expect((await getFlow(platform.env, flowId, ""))?.name).toBe("Mío");
    expect(await getFlow(platform.env, hiddenId, "")).toBeNull();

    const forced = (await (
      await call("POST", "/api/bundles/insurance-auto-light/sync", {
        force: true,
        flowIds: [flowId],
      })
    ).json()) as { updated: string[] };
    expect(forced.updated).toContain(flowId);
    expect((await getFlow(platform.env, flowId, ""))?.name).not.toBe("Mío");
    // Even forced, hidden flows are never resurrected.
    expect(await getFlow(platform.env, hiddenId, "")).toBeNull();
  }, 30_000);

  it("installs missing flows and validates input", async () => {
    await bundleFlowId();
    const missing = "sura-autos-provider";
    await platform.env.DB.prepare("DELETE FROM flows WHERE id=?")
      .bind(missing)
      .run();

    const installed = (await (
      await call("POST", "/api/bundles/insurance-auto-light/sync", {
        flowIds: [missing],
      })
    ).json()) as { installed: string[] };
    expect(installed.installed).toContain(missing);
    expect(await getFlow(platform.env, missing, "")).not.toBeNull();

    expect(
      (
        await call("POST", "/api/bundles/insurance-auto-light/sync", {
          flowIds: ["nope"],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("POST", "/api/bundles/insurance-auto-light/sync", {
          flowIds: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/api/bundles/insurance-auto-light/sync", {
          force: "yes",
        })
      ).status,
    ).toBe(400);
  }, 30_000);

  it("syncs tenant overlays without touching the global catalog", async () => {
    const flowId = await bundleFlowId();
    await ensureInsuranceAutoLightBundle(platform.env, TENANT_A);
    await backdateFlow(flowId, { tenant: TENANT_A });

    const result = (await (
      await call("POST", "/api/bundles/insurance-auto-light/sync", {}, TENANT_A)
    ).json()) as { updated: string[] };
    expect(result.updated).toContain(flowId);
    expect(
      (await getFlow(platform.env, flowId, TENANT_A))?.description,
    ).not.toContain("[v0]");
    expect(await bundleStatus(platform.env, TENANT_A)).toMatchObject({
      updateAvailable: false,
    });
    // Globals untouched by tenant syncs.
    const marker = await platform.env.DB.prepare(
      "SELECT version FROM installed_bundles WHERE id=?",
    )
      .bind("insurance-auto-light")
      .first<{ version: string }>();
    expect(marker?.version).toBe("1.1.0");
  }, 30_000);
});
