import { describe, expect, it } from "vitest";
import {
  connectorExecutorFromEnvironment,
  extensionConnectionsEncryptionKeyFromEnvironment,
} from "../src/crm/connector-executor";

const context = {
  tenantId: "agency:7",
  principalId: "user-a",
  extensionId: "inventory.sync",
  actionId: "pull",
  connectionId: "warehouse",
  runId: "run-a",
};

describe("extension action connector gateway", () => {
  it("uses the dedicated extension connection key instead of the CRM integration key", () => {
    expect(
      extensionConnectionsEncryptionKeyFromEnvironment({
        CRM_INTEGRATION_KEY: "crm-integration-key",
        EXTENSION_CONNECTIONS_ENCRYPTION_KEY: "extension-connection-key",
      }),
    ).toBe("extension-connection-key");
  });

  it("forwards only an extension execution context to the private service binding", async () => {
    const executor = connectorExecutorFromEnvironment({
      CONNECTOR_GATEWAY: {
        fetch: async (request) => {
          expect(request.url).toBe(
            "https://savia-connectors.internal/internal/execute",
          );
          expect([...request.headers.keys()]).toEqual(["content-type"]);
          expect(await request.json()).toEqual({
            ...context,
            input: { since: "2026-09-15T00:00:00.000Z" },
          });
          return Response.json({
            status: "succeeded",
            output: { imported: 3 },
          });
        },
      },
    });

    await expect(
      executor.execute(context, { since: "2026-09-15T00:00:00.000Z" }),
    ).resolves.toEqual({ status: "succeeded", output: { imported: 3 } });
  });

  it("maps a private gateway failure to an allowlisted public code", async () => {
    const executor = connectorExecutorFromEnvironment({
      CONNECTOR_GATEWAY: {
        fetch: async () =>
          Response.json(
            {
              error: {
                code: "CONNECTOR_EXECUTION_FAILED",
                diagnostic: "secret",
              },
            },
            { status: 502 },
          ),
      },
    });

    await expect(executor.execute(context, {})).resolves.toEqual({
      status: "failed",
      output: { code: "CONNECTOR_EXECUTION_FAILED" },
    });
  });
});
