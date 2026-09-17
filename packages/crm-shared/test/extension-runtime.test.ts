import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createExtensionRegistry,
  type TrustedExtension,
} from "../src/extension-package";

function extension(runtime?: TrustedExtension["runtime"]): TrustedExtension {
  return {
    manifest: {
      format: "savia.extension",
      formatVersion: 1,
      id: "inventory.sync",
      version: "1.0.0",
      label: "Inventory sync",
      description: "Synchronizes inventory from a tenant connection.",
      requires: [],
      apiVersion: 1,
    },
    runtime,
  };
}

const connector = {
  extensionId: "inventory.sync",
  connectorId: "warehouse",
  label: "Warehouse",
  configurationSchema: z
    .object({ endpoint: z.string().url(), apiKey: z.string().min(1) })
    .strict(),
  secretFields: ["apiKey"],
} as const;

describe("extension runtime contributions", () => {
  it("retains settings when their defaults satisfy the extension schema", () => {
    const registry = createExtensionRegistry([
      extension({
        settings: {
          extensionId: "inventory.sync",
          schema: z.object({ enabled: z.boolean() }).strict(),
          defaults: { enabled: true },
        },
      }),
    ]);

    expect(registry.get("inventory.sync")?.runtime?.settings?.defaults).toEqual({
      enabled: true,
    });
  });

  it("retains validated connectors and actions on their trusted extension", () => {
    const registry = createExtensionRegistry([
      extension({
        connectors: [connector],
        actions: [
          {
            extensionId: "inventory.sync",
            actionId: "pull",
            connectorId: "warehouse",
            inputSchema: z.object({ since: z.string().datetime() }).strict(),
          },
        ],
      }),
    ]);

    expect(registry.get("inventory.sync")?.runtime?.connectors).toEqual([
      connector,
    ]);
    expect(registry.get("inventory.sync")?.runtime?.actions[0]).toMatchObject({
      actionId: "pull",
      connectorId: "warehouse",
    });
  });

  it("rejects a runtime action that reaches a connector outside its extension", () => {
    expect(() =>
      createExtensionRegistry([
        extension({
          connectors: [connector],
          actions: [
            {
              extensionId: "inventory.sync",
              actionId: "pull",
              connectorId: "other.connector",
              inputSchema: z.object({}).strict(),
            },
          ],
        }),
      ]),
    ).toThrow("conector");
  });

  it("rejects a secret field absent from the connector configuration", () => {
    expect(() =>
      createExtensionRegistry([
        extension({
          connectors: [{ ...connector, secretFields: ["password"] }],
          actions: [],
        }),
      ]),
    ).toThrow("secreto");
  });
});
