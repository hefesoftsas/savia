import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { existsSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import { createStudioApp } from "../src/index";
import { ExtensionConnectionRepository } from "../src/extension-connections";
import { ExtensionSettingsRepository } from "../src/extension-settings";
import { isExtensionAvailable } from "../src/extensions";

const ARTIFACT = new URL(
  "../../../dist/plugin-store/custom.quotes-ui-1.0.1.store.zip",
  import.meta.url,
);

// Requiere `pnpm store:pack store-ports/quotes-ui`. En CI sin artefacto se omite.
const hasArtifact = existsSync(ARTIFACT);
const maybe = hasArtifact ? it : it.skip;

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;

const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

// Imita a savia-request: devuelve un run mock con éxito.
const seenUrls: string[] = [];
const saviaRequestService = {
  fetch: (async (request: Request) => {
    seenUrls.push(request.url);
    return Response.json({
      status: "success",
      result: {
        quoteNumber: "SIM-SBS-PRODUCTO-8",
        premiumTotal: "1500000",
        currency: "COP",
        simulated: true,
      },
    });
  }) as typeof fetch,
};

function app(tenant: string) {
  const isActive = (tenantId: string, extensionId: string) =>
    isExtensionAvailable(platform.env.DB, tenantId, extensionId, undefined);
  return createStudioApp(tenant, {
    seedObjects: [],
    principalId: "user-q",
    connectionRepository: new ExtensionConnectionRepository(platform.env.DB, {
      encryptionKey,
      isExtensionActive: isActive,
    }),
    settingsRepository: new ExtensionSettingsRepository(platform.env.DB, {
      isExtensionActive: isActive,
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
  const response = await app(tenant).request(
    "http://localhost/api" + path,
    {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    platform.env,
  );
  const text = await response.text();
  return {
    status: response.status,
    json: (text ? JSON.parse(text) : null) as any,
  };
}

async function uploadRealZip(tenant: string): Promise<number> {
  const zip = readFileSync(ARTIFACT);
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

describe("port real custom.quotes-ui con ejecución nativa", () => {
  maybe(
    "ejecuta quote sin delegar al release.",
    async () => {
      const tenant = "quotes-native-demo";
      await uploadRealZip(tenant);
      expect(
        (await call(tenant, "/extensions/custom.quotes-ui/install", "POST"))
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
            mode: "mock",
            flowId: "sbs-producto-8",
            quoteInput: {
              vehicle: {
                plate: "TESTCAR",
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
        data: { quoteNumber: "SIM-SBS-PRODUCTO-8", simulated: true },
      });
      expect(seenUrls.at(-1)).toContain("/api/flows/sbs-producto-8/runs");
    },
    60000,
  );

  maybe("exige servicio savia-request inyectado.", async () => {
    const tenant = "quotes-native-noservice";
    await uploadRealZip(tenant);
    await call(tenant, "/extensions/custom.quotes-ui/install", "POST");
    const isActive = (tenantId: string, extensionId: string) =>
      isExtensionAvailable(platform.env.DB, tenantId, extensionId, undefined);
    const bare = createStudioApp(tenant, {
      seedObjects: [],
      principalId: "user-q",
      connectionRepository: new ExtensionConnectionRepository(platform.env.DB, {
        encryptionKey,
        isExtensionActive: isActive,
      }),
      settingsRepository: new ExtensionSettingsRepository(platform.env.DB, {
        isExtensionActive: isActive,
      }),
    });
    const response = await bare.request(
      "http://localhost/api/extensions/custom.quotes-ui/actions/quote",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            mode: "mock",
            flowId: "sbs-producto-8",
            quoteInput: {
              vehicle: {
                plate: "TESTCAR",
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
        }),
      },
      platform.env,
    );
    expect(response.status).toBe(502);
  });
});
