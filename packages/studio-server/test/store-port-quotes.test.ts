import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { existsSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import { z } from "zod";
import { createExtensionRegistry } from "@savia/crm-shared/extension-package";
import { createCrmApp } from "../src/index";
import { ExtensionConnectionRepository } from "../src/extension-connections";
import { ExtensionSettingsRepository } from "../src/extension-settings";
import { isExtensionAvailable } from "../src/extensions";

const ARTIFACT = new URL(
  "../../../dist/plugin-store/custom.quotes-ui-1.0.0.store.zip",
  import.meta.url,
);

// Requiere `pnpm store:pack store-ports/quotes-ui`. En CI sin artefacto se omite.
const hasArtifact = existsSync(ARTIFACT);
const maybe = hasArtifact ? it : it.skip;

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;

const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

const quotesRegistry = createExtensionRegistry([
  {
    manifest: {
      format: "savia.extension",
      formatVersion: 1,
      id: "insurance.quotes",
      version: "1.0.0",
      label: "Cotizaciones de seguros",
      description: "Conecta proveedores de seguros.",
      requires: [],
      apiVersion: 1,
    },
    runtime: {
      connectors: [
        {
          extensionId: "insurance.quotes",
          connectorId: "insurance.quotes.provider",
          label: "Proveedor de seguros",
          configurationSchema: z.object({ provider: z.string() }).passthrough(),
          secretFields: [],
        },
      ],
      actions: [
        {
          extensionId: "insurance.quotes",
          actionId: "quote",
          connectorId: "insurance.quotes.provider",
          inputSchema: z.record(z.string(), z.unknown()),
          connectionOptional: true,
        },
      ],
    },
  },
]);

// Imita al executor del release (savia-request): responde normalizado.
const seenContexts: Array<Record<string, unknown>> = [];
const fakeExecutor = {
  execute: vi.fn(async (context: any, input: any) => {
    seenContexts.push({ ...context });
    const plate = (input as any)?.quoteInput?.vehicle?.plate ?? "SIN-PLACA";
    return {
      status: "succeeded" as const,
      output: {
        type: "quote",
        provider: "savia-request",
        status: "success",
        data: {
          quoteNumber: `LIVE-${plate}`,
          premiumTotal: 2345678,
          currency: "COP",
          simulated: false,
        },
      },
    };
  }),
};

function app(tenant: string) {
  const isActive = (tenantId: string, extensionId: string) =>
    isExtensionAvailable(
      platform.env.DB,
      tenantId,
      extensionId,
      quotesRegistry,
    );
  return createCrmApp(tenant, {
    seedObjects: [],
    principalId: "user-q",
    extensionRegistry: quotesRegistry,
    connectionRepository: new ExtensionConnectionRepository(platform.env.DB, {
      encryptionKey,
      isExtensionActive: isActive,
    }),
    settingsRepository: new ExtensionSettingsRepository(platform.env.DB, {
      isExtensionActive: isActive,
    }),
    actionExecutor: fakeExecutor,
  });
}

async function call(
  tenant: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await app(tenant).request(
    "http://localhost/api" + path,
    {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    platform.env,
  );
  return { status: response.status, json: (await response.json()) as any };
}

async function uploadRealZip(tenant: string): Promise<number> {
  const zip = readFileSync(ARTIFACT);
  console.log(`zip bytes: ${zip.length}`);
  const form = new FormData();
  form.set(
    "file",
    new File([zip as BlobPart], "custom.quotes-ui.store.zip", {
      type: "application/zip",
    }),
  );
  const response = await app(tenant).request(
    "http://localhost/api/plugin-store/upload",
    { method: "POST", body: form },
    platform.env,
  );
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return response.status;
}

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((statement) => statement.trim()))
      await platform.env.DB.prepare(sql).run();
});

afterAll(async () => {
  await platform?.dispose();
});

describe("port real custom.quotes-ui con delegación", () => {
  maybe(
    "delega quote a insurance.quotes cuando está activa en el tenant.",
    async () => {
      const tenant = "quotes-delegate";
      await uploadRealZip(tenant);
      expect(
        (await call(tenant, "/extensions/custom.quotes-ui/install", "POST"))
          .status,
      ).toBe(200);
      expect(
        (await call(tenant, "/extensions/insurance.quotes/install", "POST"))
          .status,
      ).toBe(200);

      const settings = await call(
        tenant,
        "/extensions/custom.quotes-ui/settings",
      );
      expect(settings.status).toBe(200);
      expect(settings.json.data.value.products.length).toBeGreaterThan(10);

      const quote = await call(
        tenant,
        "/extensions/custom.quotes-ui/actions/quote",
        "POST",
        {
          input: {
            mode: "live",
            flowId: "sbs-producto-8",
            quoteInput: { vehicle: { plate: "ABC123" } },
          },
        },
      );
      expect(quote.status).toBe(201);
      expect(quote.json.data.output).toMatchObject({
        type: "quote",
        provider: "savia-request",
        data: { quoteNumber: "LIVE-ABC123", simulated: false },
      });
      // El contexto se reescribe al destino compilado.
      expect(seenContexts.at(-1)).toMatchObject({
        tenantId: tenant,
        extensionId: "insurance.quotes",
        actionId: "quote",
      });
    },
  );

  maybe("exige activar insurance.quotes antes de delegar.", async () => {
    const tenant = "quotes-delegate-off";
    await uploadRealZip(tenant);
    await call(tenant, "/extensions/custom.quotes-ui/install", "POST");
    const blocked = await call(
      tenant,
      "/extensions/custom.quotes-ui/actions/quote",
      "POST",
      { input: { mode: "live", flowId: "x", quoteInput: {} } },
    );
    expect(blocked.status).toBe(409);
  });
});
