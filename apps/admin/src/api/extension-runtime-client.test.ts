import { describe, expect, it, vi } from "vitest";
import { ExtensionRuntimeClient } from "./extension-runtime-client";

describe("ExtensionRuntimeClient", () => {
  it("uses only the active CRM domain routes for a connection and action", async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/extensions/inventory.sync/connections" && !init)
        return {
          data: [
            {
              connectionId: "warehouse",
              connectorId: "warehouse",
              configured: true,
              updatedAt: "2026-09-15T00:00:00.000Z",
            },
          ],
        };
      if (
        path === "/extensions/inventory.sync/connections/warehouse" &&
        init?.method === "PUT"
      )
        return undefined;
      if (
        path === "/extensions/inventory.sync/actions/pull" &&
        init?.method === "POST"
      )
        return { data: { output: { imported: 3 } } };
      throw new Error(`Ruta inesperada: ${path}`);
    });
    const client = new ExtensionRuntimeClient(request);

    await expect(client.listConnections("inventory.sync")).resolves.toEqual([
      expect.objectContaining({ connectionId: "warehouse", configured: true }),
    ]);
    await client.replaceConnection("inventory.sync", "warehouse", {
      connectorId: "warehouse",
      values: { endpoint: "https://warehouse.example.test", apiKey: "secret" },
    });
    await expect(
      client.execute("inventory.sync", "pull", {
        connectionId: "warehouse",
        input: { since: "2026-09-15T00:00:00.000Z" },
      }),
    ).resolves.toEqual({ output: { imported: 3 } });

    expect(request).toHaveBeenCalledWith(
      "/extensions/inventory.sync/connections/warehouse",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          connectorId: "warehouse",
          values: {
            endpoint: "https://warehouse.example.test",
            apiKey: "secret",
          },
        }),
      }),
    );
  });
});
