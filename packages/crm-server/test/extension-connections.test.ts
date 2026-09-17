import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import {
  ExtensionConnectionRepository,
  type ExtensionConnectionKey,
} from "../src/extension-connections";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;

const connection: ExtensionConnectionKey = {
  tenantId: "tenant-a",
  extensionId: "inventory.sync",
  connectionId: "warehouse",
};
const runContext = {
  ...connection,
  principalId: "user-a",
  actionId: "pull",
  runId: "run-a",
};
const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

async function applyMigrations() {
  for (const name of readdirSync("migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort())
    for (const statement of readFileSync(`migrations/${name}`, "utf8")
      .split(";")
      .filter((value) => value.trim()))
      await platform.env.DB.prepare(statement).run();
}

function repository(extensionActive = true) {
  return new ExtensionConnectionRepository(platform.env.DB, {
    encryptionKey,
    isExtensionActive: async () => extensionActive,
    now: () => new Date("2026-09-15T00:00:00.000Z"),
  });
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
});

afterAll(async () => {
  await platform?.dispose();
});

describe("extension connections", () => {
  it("lists only the caller's sanitized runs for its extension", async () => {
    const connections = repository();
    await connections.startRun(runContext, { email: "ana@example.test" });
    await connections.completeRun(runContext, {
      quoteNumber: "Q-1",
      apiKey: "provider-secret",
    });
    await connections.startRun(
      { ...runContext, principalId: "user-b", runId: "run-b" },
      {},
    );
    await connections.completeRun(
      { ...runContext, principalId: "user-b", runId: "run-b" },
      { quoteNumber: "Q-2" },
    );
    await connections.startRun(
      { ...runContext, extensionId: "other.sync", runId: "run-c" },
      {},
    );
    await connections.completeRun(
      { ...runContext, extensionId: "other.sync", runId: "run-c" },
      { quoteNumber: "Q-3" },
    );

    await expect(
      connections.listRuns({
        tenantId: "tenant-a",
        extensionId: "inventory.sync",
        principalId: "user-a",
        limit: 20,
      }),
    ).resolves.toEqual([
      {
        runId: "run-a",
        actionId: "pull",
        connectionId: "warehouse",
        status: "succeeded",
        output: { quoteNumber: "Q-1", apiKey: "[redacted]" },
        errorCode: null,
        createdAt: "2026-09-15T00:00:00.000Z",
        updatedAt: "2026-09-15T00:00:00.000Z",
      },
    ]);
  });

  it("never returns connection secret fields in a summary", async () => {
    const connections = repository();

    await connections.replace(
      { ...connection, connectorId: "warehouse", principalId: "user-a" },
      { apiKey: "secret", endpoint: "https://warehouse.example.test" },
    );

    await expect(connections.summary(connection)).resolves.toEqual({
      connectionId: "warehouse",
      connectorId: "warehouse",
      configured: true,
      updatedAt: "2026-09-15T00:00:00.000Z",
    });
    await expect(connections.revealForExecution(connection)).resolves.toEqual({
      apiKey: "secret",
      endpoint: "https://warehouse.example.test",
    });
    const row = await platform.env.DB.prepare(
      "SELECT credential_ciphertext FROM extension_connections WHERE tenant_id=? AND extension_id=? AND id=?",
    )
      .bind(
        connection.tenantId,
        connection.extensionId,
        connection.connectionId,
      )
      .first<{ credential_ciphertext: string }>();
    expect(row?.credential_ciphertext).not.toContain("secret");
  });

  it("rejects a connection for an inactive extension", async () => {
    await expect(
      repository(false).replace(
        { ...connection, connectorId: "warehouse", principalId: "user-a" },
        { apiKey: "secret" },
      ),
    ).rejects.toMatchObject({ code: "EXTENSION_DISABLED" });
  });
});
