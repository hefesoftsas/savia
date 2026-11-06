import { describe, expect, it, vi } from "vitest";
import { createRuntimeConnectorApp } from "../src/index";

describe("insurance Savia Request action", () => {
  it("does not call the private service through a compiled action", async () => {
    const fetch = vi.fn();
    const app = createRuntimeConnectorApp({
      database: {} as D1Database,
      SAVIA_REQUEST: { fetch },
    });

    const response = await app.request(
      "https://savia-connectors.internal/internal/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: "tenant-a",
          principalId: "user-a",
          extensionId: "insurance.quotes",
          actionId: "quote",
          connectionId: "simulation",
          runId: "run-a",
          input: {},
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "CONNECTOR_ACTION_NOT_FOUND" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
