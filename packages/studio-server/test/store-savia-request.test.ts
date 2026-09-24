import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { z } from "zod";
import { createExtensionRegistry } from "@savia/studio-shared/extension-package";
import { createStudioApp } from "../src/index";
import { ExtensionConnectionRepository } from "../src/extension-connections";
import { ExtensionSettingsRepository } from "../src/extension-settings";
import { isExtensionAvailable } from "../src/extensions";
// Tres workers reales en proceso: savia-request -> connector-gateway -> crm.
import saviaRequestApp from "../../../apps/savia-request/src/server/index";
import { ensureInsuranceAutoLightBundle } from "../../../apps/savia-request/src/server/store";
import { createConnectorApp } from "../../../apps/connector-gateway/src/app";
import { createInsuranceSaviaRequestConnectorAction } from "../../insurance-quotes/src/savia-request-adapter";
import { connectorExecutorFromEnvironment } from "../../../apps/api/src/studio/connector-executor";

let crm: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;
let sr: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;

const text = (value: string) => new TextEncoder().encode(value);

function makeZip(files: ReadonlyArray<{ name: string; data: Uint8Array }>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(8, 0, true);
    header.setUint32(18, file.data.length, true);
    header.setUint32(22, file.data.length, true);
    header.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(header.buffer), name, file.data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint32(20, file.data.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const part of [...chunks, ...central, new Uint8Array(end.buffer)]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

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

const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(11)));

const seenRequests: Array<Record<string, string | null>> = [];

function crmApp(tenant: string) {
  const isActive = (tenantId: string, extensionId: string) =>
    isExtensionAvailable(crm.env.DB, tenantId, extensionId, quotesRegistry);
  const saviaRequestService = {
    fetch: (request: Request) => {
      seenRequests.push({
        url: request.url,
        tenant: request.headers.get("x-savia-tenant"),
        actor: request.headers.get("x-savia-actor"),
      });
      return saviaRequestApp.request(request, {}, {
        DB: sr.env.DB,
        ENCRYPTION_KEY: "test-encryption-key",
      } as never) as Promise<Response>;
    },
  };
  const gatewayApp = createConnectorApp({
    database: crm.env.DB,
    actions: [createInsuranceSaviaRequestConnectorAction(saviaRequestService)],
  });
  return createStudioApp(tenant, {
    seedObjects: [],
    principalId: "user-e2e",
    extensionRegistry: quotesRegistry,
    connectionRepository: new ExtensionConnectionRepository(crm.env.DB, {
      encryptionKey,
      isExtensionActive: isActive,
    }),
    settingsRepository: new ExtensionSettingsRepository(crm.env.DB, {
      isExtensionActive: isActive,
    }),
    actionExecutor: connectorExecutorFromEnvironment({
      CONNECTOR_GATEWAY: {
        fetch: (request: Request) => gatewayApp.request(request),
      },
    }),
    saviaRequestService,
  });
}

async function call(
  tenant: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await crmApp(tenant).request(
    "http://localhost/api" + path,
    {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    crm.env,
  );
  return { status: response.status, json: (await response.json()) as any };
}

const delegateStore = {
  format: "savia.store",
  formatVersion: 1,
  actions: [
    {
      id: "quote",
      kind: "delegate",
      extension: "insurance.quotes",
      action: "quote",
    },
  ],
};

function delegateZip() {
  return makeZip([
    {
      name: "savia-extension.json",
      data: text(
        JSON.stringify({
          format: "savia.extension",
          formatVersion: 1,
          id: "custom.quotes-e2e",
          version: "1.0.0",
          label: "Cotizaciones e2e",
          description: "Delega a savia-request.",
          requires: [],
          apiVersion: 1,
        }),
      ),
    },
    {
      name: "dist/plugin.js",
      data: text(
        `export function render(el, savia) { el.textContent = "e2e"; }`,
      ),
    },
    { name: "store.json", data: text(JSON.stringify(delegateStore)) },
  ]);
}

beforeAll(async () => {
  crm = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(`migrations/${file}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((statement) => statement.trim()))
      await crm.env.DB.prepare(sql).run();

  sr = await getPlatformProxy({
    configPath: "../../apps/savia-request/wrangler.jsonc",
    persist: false,
  });
  for (const file of readdirSync("../../apps/savia-request/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync(
      `../../apps/savia-request/migrations/${file}`,
      "utf8",
    )
      .split(";")
      .filter((statement) => statement.trim()))
      await sr.env.DB.exec(sql + ";");
  await ensureInsuranceAutoLightBundle({
    DB: sr.env.DB,
    ENCRYPTION_KEY: "test-encryption-key",
  } as never);
}, 180000);

afterAll(async () => {
  await crm?.dispose();
  await sr?.dispose();
});

describe("cotización live vía savia-request desde el store", () => {
  it("ejecuta un flujo mock real de punta a punta.", async () => {
    const tenant = "quotes-sr-e2e";
    const form = new FormData();
    form.set(
      "file",
      new File([delegateZip() as BlobPart], "plugin.zip", {
        type: "application/zip",
      }),
    );
    const uploaded = await crmApp(tenant).request(
      "http://localhost/api/plugin-store/upload",
      { method: "POST", body: form },
      crm.env,
    );
    expect(uploaded.status, await uploaded.text()).toBe(200);
    expect(
      (await call(tenant, "/extensions/custom.quotes-e2e/install", "POST"))
        .status,
    ).toBe(200);
    expect(
      (await call(tenant, "/extensions/insurance.quotes/install", "POST"))
        .status,
    ).toBe(200);

    const quote = await call(
      tenant,
      "/extensions/custom.quotes-e2e/actions/quote",
      "POST",
      {
        input: {
          mode: "mock",
          flowId: "sbs-producto-8",
          quoteInput: {
            vehicle: {
              plate: "ABC123",
              fasecoldaCode: "00000000",
              productionYear: 2024,
              isNew: false,
              circulationCity: "11001",
              accessoriesValue: 0,
              declaredValue: 50000000,
            },
            applicant: {
              documentType: "CC",
              documentNumber: "0000000000",
              firstName: "PERSONA",
              surname: "SIMULADA",
              gender: "F",
              birthDate: "1990-01-01",
              city: "11001",
              address: "CALLE 1",
              phone: "3000000000",
              email: "demo@example.invalid",
            },
          },
        },
      },
    );
    expect(quote.status).toBe(201);
    // Respuesta normalizada del run mock real de savia-request.
    expect(quote.json.data.output).toMatchObject({
      type: "quote",
      provider: "SBS",
      status: "success",
      data: {
        quoteNumber: "SIM-SBS-PRODUCTO-8",
        currency: "COP",
        simulated: true,
      },
    });
    // El scope del tenant y el actor viajan hasta savia-request.
    expect(seenRequests.at(-1)).toMatchObject({
      tenant,
      actor: "user-e2e",
    });
    expect(seenRequests.at(-1)?.url).toContain(
      "/api/flows/sbs-producto-8/runs",
    );
  }, 60000);
});

const QUOTES_ARTIFACT = new URL(
  "../../../dist/plugin-store/insurance.quotes-1.3.0.store.zip",
  import.meta.url,
);
const hasQuotesArtifact = existsSync(QUOTES_ARTIFACT);
const maybeQuotes = hasQuotesArtifact ? it : it.skip;

describe("port real insurance.quotes con ejecución nativa", () => {
  maybeQuotes(
    "ejecuta flujos sin delegar al release.",
    async () => {
      const tenant = "quotes-native";
      const zip = readFileSync(QUOTES_ARTIFACT);
      const form = new FormData();
      form.set(
        "file",
        new File([zip as BlobPart], "quotes.store.zip", {
          type: "application/zip",
        }),
      );
      const uploaded = await crmApp(tenant).request(
        "http://localhost/api/plugin-store/upload",
        { method: "POST", body: form },
        crm.env,
      );
      expect(uploaded.status, await uploaded.text()).toBe(200);
      expect(
        (await call(tenant, "/extensions/insurance.quotes/install", "POST"))
          .status,
      ).toBe(200);

      const settings = await call(
        tenant,
        "/extensions/insurance.quotes/settings",
      );
      expect(settings.status).toBe(200);
      expect(settings.json.data.value.products.length).toBeGreaterThan(10);

      const quote = await call(
        tenant,
        "/extensions/insurance.quotes/actions/quote",
        "POST",
        {
          input: {
            mode: "mock",
            flowId: "sbs-producto-8",
            quoteInput: {
              vehicle: {
                plate: "ABC123",
                fasecoldaCode: "00000000",
                productionYear: 2024,
                isNew: false,
                circulationCity: "11001",
                accessoriesValue: 0,
                declaredValue: 50000000,
              },
              applicant: {
                documentType: "CC",
                documentNumber: "0000000000",
                firstName: "PERSONA",
                surname: "SIMULADA",
                gender: "F",
                birthDate: "1990-01-01",
                city: "11001",
                address: "CALLE 1",
                phone: "3000000000",
                email: "demo@example.invalid",
              },
            },
          },
        },
      );
      expect(quote.status).toBe(201);
      expect(quote.json.data.output).toMatchObject({
        type: "quote",
        provider: "SBS",
        status: "success",
        data: {
          quoteNumber: "SIM-SBS-PRODUCTO-8",
          currency: "COP",
          simulated: true,
        },
      });
      expect(seenRequests.at(-1)).toMatchObject({
        tenant,
        actor: "user-e2e",
      });
    },
    60000,
  );
});
