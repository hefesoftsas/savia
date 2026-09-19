import { describe, expect, it, vi } from "vitest";
import { ConnectorRegistry } from "../src/registry";

const context = {
  tenantId: "tenant-a",
  principalId: "user-a",
  extensionId: "inventory.sync",
  actionId: "pull",
  connectionId: "warehouse",
  runId: "run-a",
};

describe("connector registry", () => {
  it("does not reveal a connection for an optional simulated action", async () => {
    const revealForExecution = vi.fn();
    const registry = new ConnectorRegistry(
      { revealForExecution },
      [
        {
          extensionId: "inventory.sync",
          actionId: "preview",
          requiresConnection: (input) => input.mode !== "mock",
          execute: async ({ connection }) => ({ connection }),
        },
      ],
    );

    await expect(
      registry.execute(
        { ...context, actionId: "preview", connectionId: "simulation" },
        { mode: "mock" },
      ),
    ).resolves.toEqual({ status: "succeeded", output: { connection: {} } });
    expect(revealForExecution).not.toHaveBeenCalled();
  });

  it("executes only a registered extension action", async () => {
    const registry = new ConnectorRegistry({
      revealForExecution: async () => ({ apiKey: "secret-value" }),
    });

    await expect(registry.execute(context, {})).rejects.toMatchObject({
      code: "CONNECTOR_ACTION_NOT_FOUND",
    });
  });

  it("does not expose decrypted values in connector errors", async () => {
    const registry = new ConnectorRegistry(
      {
        revealForExecution: async () => ({ apiKey: "secret-value" }),
      },
      [
        {
          extensionId: "inventory.sync",
          actionId: "pull",
          execute: async () => {
            throw new Error("secret-value");
          },
        },
      ],
    );

    await expect(registry.execute(context, {})).rejects.toMatchObject({
      code: "CONNECTOR_EXECUTION_FAILED",
    });
    await expect(registry.execute(context, {})).rejects.not.toThrow(
      "secret-value",
    );
  });
});
