import { describe, expect, it } from "vitest";
import { createConnectorApp } from "../src/app";
import { createRuntimeConnectorApp } from "../src/index";

const context = {
  tenantId: "tenant-a",
  principalId: "user-a",
  extensionId: "inventory.sync",
  actionId: "pull",
  connectionId: "warehouse",
  runId: "run-a",
};

describe("private connector app", () => {
  it("executes a registered action with only its extension context", async () => {
    const app = createConnectorApp({
      database: {} as D1Database,
      registry: {
        execute: async (received, input) => ({
          status: "succeeded" as const,
          output: { received, input },
        }),
      },
    });

    const response = await app.request(
      "https://savia-connectors.internal/internal/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...context,
          input: { since: "2026-09-15T00:00:00.000Z" },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "succeeded",
      output: {
        received: context,
        input: { since: "2026-09-15T00:00:00.000Z" },
      },
    });
  });

  it("rejects a request that tries to choose a tenant outside the context contract", async () => {
    const app = createConnectorApp({
      database: {} as D1Database,
      registry: {
        execute: async () => ({ status: "succeeded" as const, output: {} }),
      },
    });

    const response = await app.request(
      "https://savia-connectors.internal/internal/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...context,
          tenantId: "tenant-forged",
          input: {},
          provider: "sura",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "CONNECTOR_REQUEST_INVALID" },
    });
  });

  it("does not register compiled insurance quote actions", async () => {
    const app = createRuntimeConnectorApp({ database: {} as D1Database });
    const response = await app.request(
      "https://savia-connectors.internal/internal/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...context,
          extensionId: "insurance.quotes",
          actionId: "quote",
          input: {},
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "CONNECTOR_ACTION_NOT_FOUND" },
    });
  });
});
