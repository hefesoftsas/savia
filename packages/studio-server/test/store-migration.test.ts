import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { existsSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import { createExtensionRegistry } from "@savia/crm-shared/extension-package";
import { createCrmApp } from "../src/index";

const ARTIFACT = new URL(
  "../../../dist/plugin-store/insurance.collections-1.1.0.store.zip",
  import.meta.url,
);

// Requiere `pnpm store:pack store-ports/collections`. En CI sin artefacto se omite.
const maybe = existsSync(ARTIFACT) ? it : it.skip;

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;

// Copia compilada 1.0.0 que vive en el release.
const compiledRegistry = createExtensionRegistry([
  {
    manifest: {
      format: "savia.extension",
      formatVersion: 1,
      id: "insurance.collections",
      version: "1.0.0",
      label: "Cartera",
      description: "Cobros y saldos.",
      requires: [],
      apiVersion: 1,
    },
  },
]);

function app(tenant: string) {
  return createCrmApp(tenant, {
    seedObjects: [],
    principalId: "user-migrate",
    extensionRegistry: compiledRegistry,
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

describe("migración fuera del release", () => {
  maybe(
    "lo subido reemplaza a lo compilado con el mismo id.",
    async () => {
      const tenant = "migrate-collections";
      // Estado inicial: compilada 1.0.0 instalada y activa.
      expect(
        (
          await call(
            tenant,
            "/extensions/insurance.collections/install",
            "POST",
          )
        ).status,
      ).toBe(200);
      const before = await call(tenant, "/extensions");
      const compiled = before.json.data.find(
        (row: any) => row.manifest.id === "insurance.collections",
      );
      expect(compiled.builtIn).toBe(false);
      expect(compiled.store ?? false).toBe(false);

      // Subir el port 1.1.0: el catálogo muestra la entrada del store.
      const zip = readFileSync(ARTIFACT);
      const form = new FormData();
      form.set(
        "file",
        new File([zip as BlobPart], "collections.store.zip", {
          type: "application/zip",
        }),
      );
      const uploaded = await app(tenant).request(
        "http://localhost/api/plugin-store/upload",
        { method: "POST", body: form },
        platform.env,
      );
      expect(uploaded.status, await uploaded.text()).toBe(200);

      const after = await call(tenant, "/extensions");
      const entry = after.json.data.find(
        (row: any) => row.manifest.id === "insurance.collections",
      );
      expect(entry).toMatchObject({
        store: true,
        shadowed: true,
        installed: { version: "1.0.0", enabled: true },
      });
      expect(entry.screens).toEqual([
        { object: "insurance_receivables", view: "records", hidden: false },
      ]);

      // Instalar migra 1.0.0 -> 1.1.0, provisiona la colección y sirve.
      const migrated = await call(
        tenant,
        "/extensions/insurance.collections/install",
        "POST",
      );
      expect(migrated.status).toBe(200);
      expect(migrated.json.data.version).toBe("1.1.0");
      const collection = await platform.env.DB.prepare(
        "SELECT name,version FROM crm_objects WHERE tenant_id=? AND name=?",
      )
        .bind(tenant, "insurance_receivables")
        .first<{ name: string; version: number }>();
      expect(collection).toMatchObject({
        name: "insurance_receivables",
        version: 1,
      });
      const served = await app(tenant).request(
        "http://localhost/api/plugin-store/insurance.collections/entry",
        {},
        platform.env,
      );
      expect(served.status).toBe(200);
      expect((await served.text()).length).toBeGreaterThan(10000);
    },
    60000,
  );
});
