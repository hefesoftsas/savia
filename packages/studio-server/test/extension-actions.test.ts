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
import { z } from "zod";
import { createExtensionRegistry } from "@savia/studio-shared/extension-package";
import { ExtensionConnectionRepository } from "../src/extension-connections";
import { ExtensionSettingsRepository } from "../src/extension-settings";
import { createStudioApp } from "../src/index";
import { isExtensionAvailable } from "../src/extensions";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
const tenant = "tenant-actions";
const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(4)));
const settingsDefinition = {
  extensionId: "inventory.sync",
  schema: z.object({ enabled: z.boolean() }).strict(),
  defaults: { enabled: true },
};

const extensionRegistry = createExtensionRegistry([
  {
    manifest: {
      format: "savia.extension",
      formatVersion: 1,
      id: "inventory.sync",
      version: "1.0.0",
      label: "Inventory sync",
      description: "Synchronizes tenant inventory.",
      requires: [],
      apiVersion: 1,
    },
    runtime: {
      settings: settingsDefinition,
      connectors: [
        {
          extensionId: "inventory.sync",
          connectorId: "warehouse",
          label: "Warehouse",
          configurationSchema: z
            .object({ endpoint: z.string().url(), apiKey: z.string().min(1) })
            .strict(),
          secretFields: ["apiKey"],
        },
      ],
      actions: [
        {
          extensionId: "inventory.sync",
          actionId: "pull",
          connectorId: "warehouse",
          inputSchema: z.object({ since: z.string().datetime() }).strict(),
        },
        {
          extensionId: "inventory.sync",
          actionId: "preview",
          connectorId: "warehouse",
          inputSchema: z.object({ mode: z.literal("mock") }).strict(),
          connectionOptional: true,
        },
      ],
    },
  },
]);

async function applyMigrations() {
  for (const name of readdirSync("migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort())
    for (const statement of readFileSync(`migrations/${name}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((value) => value.trim()))
      await platform.env.DB.prepare(statement).run();
}

function request(
  path: string,
  method = "GET",
  body?: unknown,
  executor = { execute: vi.fn() },
  canManageExtension?: () => boolean,
) {
  const connections = new ExtensionConnectionRepository(platform.env.DB, {
    encryptionKey,
    isExtensionActive: (tenantId, extensionId) =>
      isExtensionAvailable(
        platform.env.DB,
        tenantId,
        extensionId,
        extensionRegistry,
      ),
  });
  const app = createStudioApp(tenant, {
    seedObjects: [],
    principalId: "user-a",
    extensionRegistry,
    connectionRepository: connections,
    settingsRepository: new ExtensionSettingsRepository(platform.env.DB, {
      isExtensionActive: (tenantId, extensionId) =>
        isExtensionAvailable(
          platform.env.DB,
          tenantId,
          extensionId,
          extensionRegistry,
        ),
    }),
    actionExecutor: executor,
    canManageExtension,
  });
  return app.request(
    `http://localhost/api${path}`,
    {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    platform.env,
  );
}

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  await applyMigrations();
});

beforeEach(async () => {
  await platform.env.DB.exec("DELETE FROM extension_action_runs");
  await platform.env.DB.exec("DELETE FROM extension_connection_audit_events");
  await platform.env.DB.exec("DELETE FROM extension_connections");
  await platform.env.DB.exec("DELETE FROM extension_settings");
  await platform.env.DB.exec("DELETE FROM crm_extension_installations");
});

afterAll(async () => {
  await platform?.dispose();
});

describe("extension connection and action routes", () => {
  it("forbids a non-manager from changing connections or settings", async () => {
    await request("/extensions/inventory.sync/install", "POST");

    const [connectionResponse, settingsResponse] = await Promise.all([
      request(
        "/extensions/inventory.sync/connections/warehouse",
        "PUT",
        {
          connectorId: "warehouse",
          values: {
            endpoint: "https://warehouse.example.test",
            apiKey: "secret-value",
          },
        },
        undefined,
        () => false,
      ),
      request(
        "/extensions/inventory.sync/settings",
        "PUT",
        { value: { enabled: false }, version: 0 },
        undefined,
        () => false,
      ),
    ]);

    expect([connectionResponse.status, settingsResponse.status]).toEqual([
      403, 403,
    ]);
  });

  it("lets a manager read and replace versioned extension settings", async () => {
    await request("/extensions/inventory.sync/install", "POST");

    const initial = await request(
      "/extensions/inventory.sync/settings",
      "GET",
      undefined,
      undefined,
      () => true,
    );
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({
      data: { value: { enabled: true }, version: 0, updatedAt: null },
    });

    const replacement = await request(
      "/extensions/inventory.sync/settings",
      "PUT",
      { value: { enabled: false }, version: 0 },
      undefined,
      () => true,
    );
    expect(replacement.status).toBe(200);
    expect(await replacement.json()).toMatchObject({
      data: { value: { enabled: false }, version: 1 },
    });
  });

  it("hides connection and action routes while the extension is unavailable", async () => {
    expect(
      (await request("/extensions/inventory.sync/connections")).status,
    ).toBe(404);
    expect(
      (
        await request("/extensions/inventory.sync/actions/pull", "POST", {
          connectionId: "warehouse",
          input: { since: "2026-09-15T00:00:00.000Z" },
        })
      ).status,
    ).toBe(404);
  });

  it("allows an action that declares an optional connection to run in simulation", async () => {
    await request("/extensions/inventory.sync/install", "POST");
    const executor = {
      execute: vi.fn().mockResolvedValue({
        status: "succeeded",
        output: { simulated: true },
      }),
    };

    const response = await request(
      "/extensions/inventory.sync/actions/preview",
      "POST",
      { input: { mode: "mock" } },
      executor,
    );

    expect(response.status).toBe(201);
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "simulation" }),
      { mode: "mock" },
    );
  });

  it("lists the actor's sanitized extension action runs", async () => {
    await request("/extensions/inventory.sync/install", "POST");
    await request("/extensions/inventory.sync/connections/warehouse", "PUT", {
      connectorId: "warehouse",
      values: {
        endpoint: "https://warehouse.example.test",
        apiKey: "tenant-secret",
      },
    });
    const actionExecutor = {
      execute: vi.fn().mockResolvedValue({
        status: "succeeded",
        output: { records: 3, apiKey: "provider-secret" },
      }),
    };
    const executed = await request(
      "/extensions/inventory.sync/actions/pull",
      "POST",
      {
        connectionId: "warehouse",
        input: { since: "2026-09-16T00:00:00.000Z" },
      },
      actionExecutor,
    );
    expect(executed.status).toBe(201);

    const response = await request(
      "/extensions/inventory.sync/actions/runs?limit=20",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        expect.objectContaining({
          actionId: "pull",
          connectionId: "warehouse",
          status: "succeeded",
          output: { records: 3, apiKey: "[redacted]" },
          errorCode: null,
        }),
      ],
    });
  });

  it("stores a declared connection and executes its declared action", async () => {
    expect(
      (await request("/extensions/inventory.sync/install", "POST")).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/extensions/inventory.sync/connections/warehouse",
          "PUT",
          {
            connectorId: "warehouse",
            values: {
              endpoint: "https://warehouse.example.test",
              apiKey: "secret-value",
            },
          },
        )
      ).status,
    ).toBe(204);
    const executor = {
      execute: vi.fn().mockResolvedValue({
        status: "succeeded",
        output: { type: "inventory", records: 3 },
      }),
    };

    const response = await request(
      "/extensions/inventory.sync/actions/pull",
      "POST",
      {
        connectionId: "warehouse",
        input: { since: "2026-09-15T00:00:00.000Z" },
      },
      executor,
    );

    expect(response.status, await response.clone().text()).toBe(201);
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenant,
        principalId: "user-a",
        extensionId: "inventory.sync",
        actionId: "pull",
        connectionId: "warehouse",
      }),
      { since: "2026-09-15T00:00:00.000Z" },
    );
    expect((await response.json()) as unknown).toMatchObject({
      data: { output: { type: "inventory", records: 3 } },
    });
  });

  it("rejects a connection for an undeclared connector", async () => {
    await request("/extensions/inventory.sync/install", "POST");

    expect(
      (
        await request(
          "/extensions/inventory.sync/connections/warehouse",
          "PUT",
          { connectorId: "other.connector", values: {} },
        )
      ).status,
    ).toBe(422);
  });
});
