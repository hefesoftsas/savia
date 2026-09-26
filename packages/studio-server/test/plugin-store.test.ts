import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { existsSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { createStudioApp } from "../src/index";
import { ExtensionConnectionRepository } from "../src/extension-connections";
import { ExtensionSettingsRepository } from "../src/extension-settings";
import { isExtensionAvailable } from "../src/extensions";
import { shellBootstrapJs } from "../src/plugin-store";
import { verifyPluginEntryGrant } from "@savia/studio-shared/plugin-entry-grant";

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;

// --- Escritor ZIP mínimo (stored + deflated) para las pruebas ---

function crc32(bytes: Uint8Array): number {
  let table = (crc32 as { table?: Int32Array }).table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as { table?: Int32Array }).table = table;
  }
  let crc = -1;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function makeZip(
  files: ReadonlyArray<{ name: string; data: Uint8Array; deflate?: boolean }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = file.data;
    const payload = file.deflate ? deflateRawSync(raw) : raw;
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(8, file.deflate ? 8 : 0, true);
    header.setUint32(14, crc32(raw), true);
    header.setUint32(18, payload.length, true);
    header.setUint32(22, raw.length, true);
    header.setUint16(26, name.length, true);
    chunks.push(
      new Uint8Array(header.buffer),
      name,
      payload instanceof Uint8Array ? payload : new Uint8Array(payload),
    );
    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true);
    centralHeader.setUint16(6, 20, true);
    centralHeader.setUint16(10, file.deflate ? 8 : 0, true);
    centralHeader.setUint32(16, crc32(raw), true);
    centralHeader.setUint32(20, payload.length, true);
    centralHeader.setUint32(24, raw.length, true);
    centralHeader.setUint16(28, name.length, true);
    centralHeader.setUint32(42, offset, true);
    central.push(new Uint8Array(centralHeader.buffer), name);
    offset += 30 + name.length + payload.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...chunks, ...central, new Uint8Array(end.buffer)]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

const text = (value: string) => new TextEncoder().encode(value);

function pluginZip(
  overrides: {
    manifest?: Record<string, unknown>;
    entry?: string;
    store?: Record<string, unknown>;
    badStore?: boolean;
  } = {},
  options: { deflate?: boolean; omitEntry?: boolean } = {},
): Uint8Array {
  const manifest = {
    format: "savia.extension",
    formatVersion: 1,
    id: "custom.demo",
    version: "1.0.0",
    label: "Demo",
    description: "Plugin de demostración.",
    requires: [],
    apiVersion: 1,
    ...overrides.manifest,
  };
  const files = [
    {
      name: "savia-extension.json",
      data: text(JSON.stringify(manifest)),
      deflate: options.deflate,
    },
  ];
  if (!options.omitEntry)
    files.push({
      name: "dist/plugin.js",
      data: text(
        overrides.entry ??
          `export function render(el, savia) { el.textContent = "demo"; }`,
      ),
      deflate: options.deflate,
    });
  if (overrides.store !== undefined)
    files.push({
      name: "store.json",
      data: text(JSON.stringify(overrides.store)),
      deflate: options.deflate,
    });
  if (overrides.badStore)
    files.push({
      name: "store.json",
      data: text("no es json"),
      deflate: options.deflate,
    });
  return makeZip(files);
}

const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

function app(tenant: string) {
  return createStudioApp(tenant, { seedObjects: [] });
}

function appWithRuntime(tenant: string) {
  const isActive = (tenantId: string, extensionId: string) =>
    isExtensionAvailable(platform.env.DB, tenantId, extensionId, undefined);
  return createStudioApp(tenant, {
    seedObjects: [],
    principalId: "user-store",
    connectionRepository: new ExtensionConnectionRepository(platform.env.DB, {
      encryptionKey,
      isExtensionActive: isActive,
    }),
    settingsRepository: new ExtensionSettingsRepository(platform.env.DB, {
      isExtensionActive: isActive,
    }),
  });
}

async function api(
  tenant: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await appWithRuntime(tenant).request(
    "http://localhost/api" + path,
    {
      method,
      headers: { "content-type": "application/json" },
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

async function uploadZip(
  tenant: string,
  zip: Uint8Array,
  name = "plugin.zip",
): Promise<Response> {
  const form = new FormData();
  form.set(
    "file",
    new File([zip as BlobPart], name, { type: "application/zip" }),
  );
  return app(tenant).request(
    "http://localhost/api/plugin-store/upload",
    { method: "POST", body: form },
    platform.env,
  );
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

describe("plugin store por tenant", () => {
  it("genera un bootstrap parseable como módulo (sin ejecutar UI).", async () => {
    const url = `data:text/javascript,${encodeURIComponent(shellBootstrapJs())}`;
    const failure = await import(url).then(
      () => null,
      (error: unknown) => error,
    );
    // Sin window/parent en Node debe fallar en runtime, nunca en sintaxis.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).constructor.name).not.toBe("SyntaxError");
  });

  it("elige render para pantallas y el handler declarado para widgets", () => {
    const source = shellBootstrapJs().match(
      /function selectRender\(module, widgetId\) \{[\s\S]*?\n\}/,
    )?.[0];
    expect(source).toBeDefined();
    const selectRender = new Function(`${source}; return selectRender;`)() as (
      module: {
        render?: () => void;
        renderWidget?: () => void;
        widgets?: Record<string, () => void>;
      },
      widgetId: string,
    ) => (() => void) | undefined;
    const render = () => undefined;
    const renderWidget = () => undefined;
    const summary = () => undefined;
    const module = { render, renderWidget, widgets: { summary } };
    expect(selectRender(module, "")).toBe(render);
    expect(selectRender(module, "summary")).toBe(summary);
    expect(selectRender(module, "other")).toBe(renderWidget);
  });

  it("sirve el bootstrap del sandbox sin scripts inline ni unsafe-eval.", async () => {
    const tenant = "store-bootstrap";
    const bootstrap = await app(tenant).request(
      "http://localhost/api/plugin-store/shell-bootstrap.js",
      {},
      platform.env,
    );
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get("content-type")).toContain("javascript");
    expect(bootstrap.headers.get("access-control-allow-origin")).toBe("*");
    const code = await bootstrap.text();
    expect(code).toContain("import.meta.url");
    expect(code).toContain("storeBasePath");

    const uploaded = await uploadZip(tenant, pluginZip());
    expect(uploaded.status, await uploaded.text()).toBe(200);
    await app(tenant).request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    const shell = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo/shell",
      {},
      platform.env,
    );
    expect(shell.status).toBe(200);
    const html = await shell.text();
    // Sin <script> inline: todo el JS vive en shell-bootstrap.js.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).toContain("shell-bootstrap.js?plugin=custom.demo");
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1];
    const scriptSrc = csp
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    // Sin red directa posible: el shim usa postMessage y el CSP la niega.
    expect(csp).toContain("connect-src 'none'");

    const wizardShell = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo/shell?screen=cotizador_por_pasos&view=records",
      {},
      platform.env,
    );
    const wizardHtml = await wizardShell.text();
    expect(wizardHtml).toContain("screen=cotizador_por_pasos");
    expect(wizardHtml).toContain("view=records");
    expect(code).toContain('params.get("screen")');

    const darkShell = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo/shell?theme=dark",
      {},
      platform.env,
    );
    const darkHtml = await darkShell.text();
    expect(darkHtml).toContain("color-scheme:dark");
    expect(darkHtml).toContain("--background:oklch(0.145 0 0)");
    expect(html).toContain("color-scheme:light");

    const scopedShell = await createStudioApp(tenant, {
      seedObjects: [],
      apiBasePath: "/v1/data-domains/platform",
    }).request(
      "http://localhost/api/plugin-store/custom.demo/shell?screen=cotizador_por_pasos",
      {},
      platform.env,
    );
    expect(scopedShell.status).toBe(200);
    const scopedHtml = await scopedShell.text();
    const bootstrapPath = scopedHtml.match(
      /<script type="module" src="([^"]+)"/,
    )?.[1];
    expect(bootstrapPath).toBeDefined();
    const bootstrapUrl = new URL(bootstrapPath!, "http://localhost");
    expect(bootstrapUrl.pathname).toBe(
      "/v1/data-domains/platform/api/plugin-store/shell-bootstrap.js",
    );
    expect(bootstrapUrl.searchParams.get("entry")).toBe(
      "/v1/data-domains/platform/api/plugin-store/custom.demo/entry?version=1.0.0",
    );
    expect(code).toContain("entryUrl.origin !== bootstrapUrl.origin");

    const signedShell = await createStudioApp(tenant, {
      seedObjects: [],
      apiBasePath: "/v1/data-domains/platform",
      entryGrantSecret: "test-secret",
    }).request(
      "http://localhost/api/plugin-store/custom.demo/shell?screen=cotizador_por_pasos",
      {},
      platform.env,
    );
    expect(signedShell.status).toBe(200);
    const signedHtml = await signedShell.text();
    const signedPath = signedHtml.match(
      /<script type="module" src="([^"]+)"/,
    )?.[1];
    const signedUrl = new URL(
      signedPath!.replaceAll("&amp;", "&"),
      "http://localhost",
    );
    expect(signedUrl.pathname).toBe(
      "/api/public/plugin-store/shell-bootstrap.js",
    );
    const signedEntry = new URL(
      signedUrl.searchParams.get("entry")!,
      "http://localhost",
    );
    expect(signedEntry.pathname).toBe(
      "/api/public/plugin-store/custom.demo/entry",
    );
    expect(
      await verifyPluginEntryGrant(
        "test-secret",
        {
          tenantId: signedEntry.searchParams.get("tenant")!,
          pluginId: "custom.demo",
          version: signedEntry.searchParams.get("version")!,
          expiresAt: Number(signedEntry.searchParams.get("expires")),
        },
        signedEntry.searchParams.get("signature")!,
      ),
    ).toBe(true);
  });

  it("sube, instala, sirve y desactiva un plugin ZIP.", async () => {
    const tenant = "store-basic";
    const uploaded = await uploadZip(tenant, pluginZip());
    expect(uploaded.status, await uploaded.text()).toBe(200);

    const listed = await app(tenant).request(
      "http://localhost/api/plugin-store",
      {},
      platform.env,
    );
    const catalog = (await listed.json()) as any;
    expect(catalog.data).toHaveLength(1);
    expect(catalog.data[0].manifest.id).toBe("custom.demo");

    // Visible en el catálogo de extensiones como store:true.
    const extensions = (await (
      await app(tenant).request(
        "http://localhost/api/extensions",
        {},
        platform.env,
      )
    ).json()) as any;
    const entry = extensions.data.find(
      (row: any) => row.manifest.id === "custom.demo",
    );
    expect(entry).toMatchObject({ builtIn: false, store: true });

    // Instalar + activar por tenant.
    const installed = await app(tenant).request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    expect(installed.status, await installed.text()).toBe(200);

    const shell = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo/shell",
      {},
      platform.env,
    );
    expect(shell.status).toBe(200);
    expect(shell.headers.get("content-type")).toContain("text/html");

    const served = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo/entry",
      {},
      platform.env,
    );
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("javascript");
    expect(await served.text()).toContain("demo");

    // Desactivar: el shell deja de servirse.
    const disabled = await app(tenant).request(
      "http://localhost/api/extensions/custom.demo",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
      platform.env,
    );
    expect(disabled.status).toBe(200);
    const blocked = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo/shell",
      {},
      platform.env,
    );
    expect(blocked.status).toBe(404);
  });

  it("keeps installed screen bindings until a newer ZIP is installed", async () => {
    const tenant = "store-installed-screens";
    const oldStore = {
      format: "savia.store",
      formatVersion: 1,
      screens: [{ object: "legacy_screen", view: "records" }],
    };
    const newStore = {
      format: "savia.store",
      formatVersion: 1,
      screens: [{ object: "new_screen", view: "records" }],
    };
    expect(
      (await uploadZip(tenant, pluginZip({ store: oldStore }))).status,
    ).toBe(200);
    expect(
      (
        await app(tenant).request(
          "http://localhost/api/extensions/custom.demo/install",
          { method: "POST", headers: { "content-type": "application/json" } },
          platform.env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await uploadZip(
          tenant,
          pluginZip({ manifest: { version: "1.1.0" }, store: newStore }),
        )
      ).status,
    ).toBe(200);

    const extensions = (await (
      await app(tenant).request(
        "http://localhost/api/extensions",
        {},
        platform.env,
      )
    ).json()) as {
      data: Array<{ manifest: { id: string }; screens: unknown }>;
    };
    expect(
      extensions.data.find((row) => row.manifest.id === "custom.demo")?.screens,
    ).toMatchObject([{ object: "legacy_screen", view: "records" }]);
  });

  it("aísla el store por tenant.", async () => {
    await uploadZip("store-tenant-a", pluginZip());
    const other = (await (
      await app("store-tenant-b").request(
        "http://localhost/api/plugin-store",
        {},
        platform.env,
      )
    ).json()) as any;
    expect(other.data).toHaveLength(0);
    const missing = await app("store-tenant-b").request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    expect(missing.status).toBe(404);
  });

  it("acepta entradas deflated y rechaza ZIPs inválidos.", async () => {
    const tenant = "store-deflate";
    const uploaded = await uploadZip(tenant, pluginZip({}, { deflate: true }));
    expect(uploaded.status, await uploaded.text()).toBe(200);

    const noEntry = await uploadZip(
      "store-no-entry",
      pluginZip({}, { omitEntry: true }),
    );
    expect(noEntry.status).toBe(422);

    const wrongId = await uploadZip(
      "store-wrong-id",
      pluginZip({ manifest: { id: "No-valido!" } }),
    );
    expect(wrongId.status).toBe(422);

    const evil = await uploadZip(
      "store-evil",
      pluginZip({
        entry: `export function render(el){ fetch("https://evil.test"); }`,
      }),
    );
    expect(evil.status).toBe(422);

    const notZip = await uploadZip("store-not-zip", text("hola"));
    expect(notZip.status).toBe(422);
  });

  it("resuelve la última versión con semver (1.10.0 > 1.9.0).", async () => {
    const tenant = "store-semver";
    expect(
      (await uploadZip(tenant, pluginZip({ manifest: { version: "1.9.0" } })))
        .status,
    ).toBe(200);
    expect(
      (await uploadZip(tenant, pluginZip({ manifest: { version: "1.10.0" } })))
        .status,
    ).toBe(200);
    const installed = await app(tenant).request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    const installedBody = (await installed.json()) as any;
    expect(installed.status, JSON.stringify(installedBody)).toBe(200);
    expect(installedBody.data.version).toBe("1.10.0");
  });

  it("aplica cuota de 10 versiones por plugin.", async () => {
    const tenant = "store-quota";
    for (let minor = 0; minor < 10; minor++) {
      const uploaded = await uploadZip(
        tenant,
        pluginZip({ manifest: { version: `1.${minor}.0` } }),
      );
      expect(uploaded.status).toBe(200);
    }
    const rejected = await uploadZip(
      tenant,
      pluginZip({ manifest: { version: "1.10.0" } }),
    );
    expect(rejected.status).toBe(409);
  });

  it("rechaza versiones duplicadas con distinto contenido.", async () => {
    const tenant = "store-dedupe";
    const first = await uploadZip(tenant, pluginZip());
    expect(first.status).toBe(200);
    const same = await uploadZip(tenant, pluginZip());
    expect(same.status).toBe(200);
    expect(((await same.json()) as any).data.deduped).toBe(true);
    const different = await uploadZip(
      tenant,
      pluginZip({ manifest: { version: "1.0.0", label: "Otro" } }),
    );
    expect(different.status).toBe(409);
  });

  it("rejects changed JavaScript or settings under an immutable version", async () => {
    const tenant = "store-immutable-code";
    expect((await uploadZip(tenant, pluginZip())).status).toBe(200);
    expect(
      (
        await uploadZip(
          tenant,
          pluginZip({
            entry: 'export function render(el) { el.textContent = "changed"; }',
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await uploadZip(
          tenant,
          pluginZip({
            store: {
              format: "savia.store",
              formatVersion: 1,
              settings: { defaults: { changed: true } },
            },
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await uploadZip(tenant, pluginZip({}, { deflate: true }))).status,
    ).toBe(200);
  });

  it("deployment updates never install or enable optional plugins", async () => {
    const tenant = "store-deploy-update";
    await uploadZip(tenant, pluginZip());
    const request = (path: string, init: RequestInit = { method: "POST" }) =>
      app(tenant).request(
        `http://localhost/api/extensions/custom.demo${path}`,
        init,
        platform.env,
      );
    expect((await request("/install?update=enabled")).status).toBe(409);
    expect((await request("/install")).status).toBe(200);
    expect((await request("/install?update=enabled")).status).toBe(200);
    expect(
      (
        await request("", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        })
      ).status,
    ).toBe(200);
    expect((await request("/install?update=enabled")).status).toBe(409);
  });

  it("exige desactivar antes de eliminar.", async () => {
    const tenant = "store-delete";
    await uploadZip(tenant, pluginZip());
    await app(tenant).request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    const blocked = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo",
      { method: "DELETE" },
      platform.env,
    );
    expect(blocked.status).toBe(409);
    await app(tenant).request(
      "http://localhost/api/extensions/custom.demo",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
      platform.env,
    );
    const deleted = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo",
      { method: "DELETE" },
      platform.env,
    );
    expect(deleted.status, await deleted.text()).toBe(200);
  });
});

const quoteStore = {
  format: "savia.store",
  formatVersion: 1,
  actions: [
    {
      id: "quote",
      kind: "simulation",
      output: {
        type: "quote",
        provider: "simulation",
        status: "success",
        data: {
          quoteNumber: "SIM-{{input.quoteInput.vehicle.plate}}",
          premiumTotal: 1200000,
          currency: "COP",
          simulated: true,
        },
      },
    },
    {
      id: "lookup-plate",
      kind: "simulation",
      output: {
        type: "vehicle_lookup",
        provider: "simulation",
        status: "success",
        data: { vehicle: "{{input.quoteInput.vehicle}}" },
      },
    },
  ],
  settings: {
    defaults: {
      quotePages: { direct: true, wizard: true },
      vehicleLookup: { enabled: true },
    },
  },
};

describe("acciones simuladas y configuración del store", () => {
  it("rechaza un store.json inválido.", async () => {
    const bad = await uploadZip(
      "store-bad-json",
      pluginZip({ badStore: true }),
    );
    expect(bad.status).toBe(422);
    const badKind = await uploadZip(
      "store-bad-kind",
      pluginZip({
        store: {
          format: "savia.store",
          formatVersion: 1,
          actions: [{ id: "quote", kind: "http", output: {} }],
        },
      }),
    );
    expect(badKind.status).toBe(422);
  });

  it("ejecuta acciones simuladas con plantillas del input.", async () => {
    const tenant = "store-simulate";
    expect(
      (await uploadZip(tenant, pluginZip({ store: quoteStore }))).status,
    ).toBe(200);
    const installed = await api(
      tenant,
      "/extensions/custom.demo/install",
      "POST",
    );
    expect(installed.status).toBe(200);

    const quote = await api(
      tenant,
      "/extensions/custom.demo/actions/quote",
      "POST",
      {
        input: {
          mode: "live",
          flowId: "demo-flow",
          quoteInput: { vehicle: { plate: "abc123" } },
        },
      },
    );
    expect(quote.status).toBe(201);
    expect(quote.json.data.output).toMatchObject({
      type: "quote",
      status: "success",
      data: {
        quoteNumber: "SIM-abc123",
        premiumTotal: 1200000,
        simulated: true,
      },
    });
    expect(quote.json.data.run.status).toBe("succeeded");

    const lookup = await api(
      tenant,
      "/extensions/custom.demo/actions/lookup-plate",
      "POST",
      { input: { quoteInput: { vehicle: { plate: "XYZ" } } } },
    );
    expect(lookup.status).toBe(201);
    expect(lookup.json.data.output.data.vehicle).toEqual({ plate: "XYZ" });

    const unknown = await api(
      tenant,
      "/extensions/custom.demo/actions/otra",
      "POST",
      { input: {} },
    );
    expect(unknown.status).toBe(404);
  });

  it("bloquea acciones simuladas cuando el plugin está desactivado.", async () => {
    const tenant = "store-simulate-off";
    await uploadZip(tenant, pluginZip({ store: quoteStore }));
    await api(tenant, "/extensions/custom.demo/install", "POST");
    await api(tenant, "/extensions/custom.demo", "PATCH", { enabled: false });
    const blocked = await api(
      tenant,
      "/extensions/custom.demo/actions/quote",
      "POST",
      { input: {} },
    );
    expect(blocked.status).toBe(404);
  });

  it("sirve y actualiza la configuración declarada del store.", async () => {
    const tenant = "store-settings";
    await uploadZip(tenant, pluginZip({ store: quoteStore }));
    await api(tenant, "/extensions/custom.demo/install", "POST");

    const initial = await api(tenant, "/extensions/custom.demo/settings");
    expect(initial.status).toBe(200);
    expect(initial.json.data.value).toEqual({
      quotePages: { direct: true, wizard: true },
      vehicleLookup: { enabled: true },
    });
    expect(initial.json.data.version).toBe(0);

    const replaced = await api(
      tenant,
      "/extensions/custom.demo/settings",
      "PUT",
      {
        value: {
          quotePages: { direct: false, wizard: true },
          vehicleLookup: { enabled: true },
        },
        version: 0,
      },
    );
    expect(replaced.status).toBe(200);
    expect(replaced.json.data.version).toBe(1);

    const conflict = await api(
      tenant,
      "/extensions/custom.demo/settings",
      "PUT",
      { value: {}, version: 0 },
    );
    expect(conflict.status).toBe(409);
  });

  it("acepta entradas grandes de ~1.3 MB (tamaño del bundle de cotizaciones).", async () => {
    const tenant = "store-big-entry";
    const bigEntry = `export function render(el, savia) { el.textContent = "demo"; }\n/*${"x".repeat(1300 * 1024)}*/`;
    const uploaded = await uploadZip(tenant, pluginZip({ entry: bigEntry }));
    expect(uploaded.status, await uploaded.text()).toBe(200);
    await api(tenant, "/extensions/custom.demo/install", "POST");
    const served = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo/entry",
      {},
      platform.env,
    );
    expect(served.status).toBe(200);
    expect((await served.text()).length).toBeGreaterThan(1300 * 1024);
  });
});

const tareasStore = {
  format: "savia.store",
  formatVersion: 1,
  collections: [
    {
      object: {
        name: "tareas",
        label: "Tareas",
        description: "Tareas del plugin.",
        config: {
          version: 2,
          fields: {
            name: { type: "Textbox", label: "Nombre", required: true },
          },
          fieldOrder: ["name"],
        },
      },
      requiredFields: { name: { types: ["Textbox"], required: true } },
    },
  ],
};

async function storedObject(tenant: string, name: string) {
  return platform.env.DB.prepare(
    "SELECT name,label,config,version FROM studio_objects WHERE tenant_id=? AND name=?",
  )
    .bind(tenant, name)
    .first<{ name: string; label: string; config: string; version: number }>();
}

describe("provisión de colecciones del store", () => {
  it("crea la colección al instalar y la repara al reinstalar.", async () => {
    const tenant = "store-provision";
    await uploadZip(tenant, pluginZip({ store: tareasStore }));
    const installed = await app(tenant).request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    expect(installed.status, await installed.text()).toBe(200);
    const created = await storedObject(tenant, "tareas");
    expect(created).toMatchObject({
      name: "tareas",
      label: "Tareas",
      version: 1,
    });

    await app(tenant).request(
      "http://localhost/api/objects/tareas",
      { method: "DELETE" },
      platform.env,
    );
    const repaired = await app(tenant).request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    expect(repaired.status).toBe(200);
    expect(await storedObject(tenant, "tareas")).not.toBeNull();
    expect(await storedObject("store-provision-otro", "tareas")).toBeNull();
  });

  it("conserva la colección compatible y rechaza la incompatible.", async () => {
    const compatible = "store-compatible";
    await platform.env.DB.prepare(
      "INSERT INTO studio_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,1)",
    )
      .bind(
        compatible,
        "tareas",
        "Tareas",
        "Tareas del plugin.",
        JSON.stringify({
          version: 2,
          fields: {
            name: { type: "Textbox", label: "Nombre", required: true },
            extra: { type: "Textbox", label: "Extra" },
          },
          fieldOrder: ["name", "extra"],
        }),
      )
      .run();
    await uploadZip(compatible, pluginZip({ store: tareasStore }));
    const kept = await app(compatible).request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    expect(kept.status).toBe(200);
    expect(
      JSON.parse((await storedObject(compatible, "tareas"))!.config),
    ).toHaveProperty("fields.extra");

    const incompatible = "store-incompatible";
    await platform.env.DB.prepare(
      "INSERT INTO studio_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,1)",
    )
      .bind(
        incompatible,
        "tareas",
        "Tareas",
        "Otra.",
        JSON.stringify({
          version: 2,
          fields: { name: { type: "Textarea", label: "Nombre" } },
          fieldOrder: ["name"],
        }),
      )
      .run();
    await uploadZip(incompatible, pluginZip({ store: tareasStore }));
    const rejected = await app(incompatible).request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    expect(rejected.status).toBe(409);
    const installation = await platform.env.DB.prepare(
      "SELECT count(*) as count FROM studio_extension_installations WHERE tenant_id=? AND id=?",
    )
      .bind(incompatible, "custom.demo")
      .first<{ count: number }>();
    expect(installation).toEqual({ count: 0 });
  });
});

const httpStore = {
  format: "savia.store",
  formatVersion: 1,
  connectors: [
    {
      id: "sura",
      label: "Sura Seguros",
      secretFields: ["apiKey"],
      configSchema: {
        type: "object",
        required: ["baseUrl", "apiKey"],
        properties: {
          baseUrl: { type: "string" },
          apiKey: { type: "string" },
          mode: { type: "string", enum: ["prod", "test"] },
        },
      },
      allowedHosts: ["api.sura.com"],
    },
  ],
  actions: [
    {
      id: "cotizar",
      kind: "http",
      connector: "sura",
      request: {
        method: "POST",
        url: "https://{{connection.baseUrl}}/cotizar",
        headers: {
          Authorization: "Bearer {{connection.apiKey}}",
          "content-type": "application/json",
        },
        body: { placa: "{{input.placa}}", mode: "{{connection.mode}}" },
      },
    },
    {
      id: "ping",
      kind: "http",
      connector: "sura",
      connectionOptional: true,
      request: { method: "GET", url: "https://api.sura.com/ping" },
    },
  ],
};

describe("acciones http declarativas", () => {
  const realFetch = globalThis.fetch;
  let seen: Array<{ url: string; init: RequestInit }>;
  const tenant = "store-http";

  async function setup() {
    seen = [];
    globalThis.fetch = (async (url: any, init: any) => {
      seen.push({ url: String(url), init });
      return Response.json({
        quoteNumber: "Q-1",
        apiKey: "OTRA-CLAVE",
        nested: { token: "T", prima: 5 },
      });
    }) as typeof fetch;
    await uploadZip(tenant, pluginZip({ store: httpStore }));
    await api(tenant, "/extensions/custom.demo/install", "POST");
  }

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("valida la conexión contra el esquema y ejecuta con secretos redactados.", async () => {
    await setup();
    const bad = await api(
      tenant,
      "/extensions/custom.demo/connections/sura",
      "PUT",
      { connectorId: "sura", values: { baseUrl: "api.sura.com" } },
    );
    expect(bad.status).toBe(422);
    const badEnum = await api(
      tenant,
      "/extensions/custom.demo/connections/sura",
      "PUT",
      {
        connectorId: "sura",
        values: { baseUrl: "api.sura.com", apiKey: "K", mode: "otro" },
      },
    );
    expect(badEnum.status).toBe(422);
    const unknown = await api(
      tenant,
      "/extensions/custom.demo/connections/otro",
      "PUT",
      { connectorId: "otro", values: {} },
    );
    expect(unknown.status).toBe(422);

    const saved = await api(
      tenant,
      "/extensions/custom.demo/connections/sura",
      "PUT",
      {
        connectorId: "sura",
        values: { baseUrl: "api.sura.com", apiKey: "K-SECRETA", mode: "test" },
      },
    );
    expect(saved.status).toBe(204);

    const listed = await api(tenant, "/extensions/custom.demo/connections");
    expect(listed.status).toBe(200);
    expect(listed.json.data).toHaveLength(1);

    const missing = await api(
      tenant,
      "/extensions/custom.demo/actions/cotizar",
      "POST",
      { input: { placa: "TESTCAR" } },
    );
    expect(missing.status).toBe(422);

    const quote = await api(
      tenant,
      "/extensions/custom.demo/actions/cotizar",
      "POST",
      { connectionId: "sura", input: { placa: "TESTCAR" } },
    );
    expect(quote.status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.sura.com/cotizar");
    expect(seen[0].init.method).toBe("POST");
    expect(
      (seen[0].init.headers as Record<string, string>)["Authorization"],
    ).toBe("Bearer K-SECRETA");
    expect(JSON.parse(seen[0].init.body as string)).toEqual({
      placa: "TESTCAR",
      mode: "test",
    });
    expect(quote.json.data.output).toEqual({
      status: 200,
      data: { quoteNumber: "Q-1", nested: { prima: 5 } },
    });
  });

  it("ejecuta acciones opcionales sin conexión y rechaza hosts fuera del allowlist.", async () => {
    await setup();
    const ping = await api(
      tenant,
      "/extensions/custom.demo/actions/ping",
      "POST",
      { input: {} },
    );
    expect(ping.status).toBe(201);
    expect(seen[0].url).toBe("https://api.sura.com/ping");
  });

  it("rechaza plantillas que apuntan fuera del allowlist.", async () => {
    const evilTenant = "store-http-evil";
    await uploadZip(
      evilTenant,
      pluginZip({
        store: {
          ...httpStore,
          actions: [
            {
              id: "evil",
              kind: "http",
              connector: "sura",
              connectionOptional: true,
              request: { method: "GET", url: "https://evil.test/x" },
            },
          ],
        },
      }),
    );
    await api(evilTenant, "/extensions/custom.demo/install", "POST");
    const blocked = await api(
      evilTenant,
      "/extensions/custom.demo/actions/evil",
      "POST",
      { input: {} },
    );
    expect(blocked.status).toBe(422);
  });

  it("devuelve 502 si el proveedor falla.", async () => {
    await setup();
    globalThis.fetch = (async () =>
      new Response("falla", { status: 500 })) as typeof fetch;
    await api(tenant, "/extensions/custom.demo/connections/sura", "PUT", {
      connectorId: "sura",
      values: { baseUrl: "api.sura.com", apiKey: "K" },
    });
    const failed = await api(
      tenant,
      "/extensions/custom.demo/actions/cotizar",
      "POST",
      { connectionId: "sura", input: { placa: "X" } },
    );
    expect(failed.status).toBe(502);
  });

  it("rechaza respuestas que reflejan un secreto.", async () => {
    await setup();
    globalThis.fetch = (async () =>
      Response.json({
        quoteNumber: "Q-1",
        apiKey: "K-SECRETA",
      })) as typeof fetch;
    await api(tenant, "/extensions/custom.demo/connections/sura", "PUT", {
      connectorId: "sura",
      values: { baseUrl: "api.sura.com", apiKey: "K-SECRETA" },
    });
    const reflected = await api(
      tenant,
      "/extensions/custom.demo/actions/cotizar",
      "POST",
      { connectionId: "sura", input: { placa: "X" } },
    );
    expect(reflected.status).toBe(502);
  });

  it("permite el host configurado y usa el contexto en plantillas.", async () => {
    const tenant = "store-http-configured";
    await uploadZip(
      tenant,
      pluginZip({
        store: {
          format: "savia.store",
          formatVersion: 1,
          connectors: [
            {
              id: "gw",
              label: "Gateway",
              secretFields: ["token"],
              configSchema: {
                type: "object",
                required: ["endpoint", "token"],
                properties: {
                  endpoint: { type: "string" },
                  token: { type: "string" },
                },
              },
              allowedHosts: [],
              allowConfiguredHost: true,
            },
          ],
          actions: [
            {
              id: "enviar",
              kind: "http",
              connector: "gw",
              request: {
                method: "POST",
                url: "{{connection.endpoint}}/enviar",
                headers: {
                  Authorization: "Bearer {{connection.token}}",
                  "Idempotency-Key":
                    "{{tenant}}:{{action}}:{{input.operationKey}}",
                },
                body: { operationKey: "{{input.operationKey}}" },
              },
            },
          ],
        },
      }),
    );
    await api(tenant, "/extensions/custom.demo/install", "POST");
    await api(tenant, "/extensions/custom.demo/connections/gw", "PUT", {
      connectorId: "gw",
      values: { endpoint: "https://proveedor.dinamico.test", token: "T" },
    });
    let idempotency = "";
    globalThis.fetch = (async (url: any, init: any) => {
      idempotency = (init.headers as Record<string, string>)["Idempotency-Key"];
      return Response.json({ reference: "R-1", state: "accepted" });
    }) as typeof fetch;
    try {
      const result = await api(
        tenant,
        "/extensions/custom.demo/actions/enviar",
        "POST",
        { connectionId: "gw", input: { operationKey: "OP-12345678" } },
      );
      expect(result.status).toBe(201);
      expect(idempotency).toBe(`${tenant}:enviar:OP-12345678`);
      expect(result.json.data.output).toEqual({
        status: 200,
        data: { reference: "R-1", state: "accepted" },
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

const mcpStore = {
  format: "savia.store",
  formatVersion: 1,
  actions: [
    {
      id: "eco",
      kind: "simulation",
      output: { ok: true },
      mcp: { label: "Eco", summary: "Devuelve un eco de demostración." },
    },
    {
      id: "interna",
      kind: "simulation",
      output: { ok: true },
    },
  ],
};

describe("catálogo mcp del store", () => {
  it("lista solo plugins activos con acciones de lectura.", async () => {
    const tenant = "store-mcp";
    await uploadZip(tenant, pluginZip({ store: mcpStore }));
    const empty = await app(tenant).request(
      "http://localhost/api/plugin-store/mcp-catalog",
      {},
      platform.env,
    );
    expect(((await empty.json()) as any).data).toEqual([]);

    await app(tenant).request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    const catalog = (await (
      await app(tenant).request(
        "http://localhost/api/plugin-store/mcp-catalog",
        {},
        platform.env,
      )
    ).json()) as any;
    expect(catalog.data).toEqual([
      {
        pluginId: "custom.demo",
        label: "Demo",
        actions: [
          {
            id: "eco",
            kind: "simulation",
            label: "[custom.demo/eco] Eco",
            summary: "Devuelve un eco de demostración.",
          },
        ],
      },
    ]);

    await app(tenant).request(
      "http://localhost/api/extensions/custom.demo",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
      platform.env,
    );
    const off = (await (
      await app(tenant).request(
        "http://localhost/api/plugin-store/mcp-catalog",
        {},
        platform.env,
      )
    ).json()) as any;
    expect(off.data).toEqual([]);
  });
});

describe("widgets del store", () => {
  const widgetStore = {
    format: "savia.store",
    formatVersion: 1,
    widgets: [
      {
        id: "resumen",
        collection: "polizas",
        title: { es: "Resumen" },
      },
    ],
  };

  it("sirve el shell del widget solo si está declarado y activo.", async () => {
    const tenant = "store-widget";
    await uploadZip(tenant, pluginZip({ store: widgetStore }));
    const missing = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo/widget?widget=resumen&collection=polizas",
      {},
      platform.env,
    );
    expect(missing.status).toBe(404);

    await app(tenant).request(
      "http://localhost/api/extensions/custom.demo/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    const shell = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo/widget?widget=resumen&collection=polizas",
      {},
      platform.env,
    );
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain("widget=resumen");

    const unknown = await app(tenant).request(
      "http://localhost/api/plugin-store/custom.demo/widget?widget=otro&collection=polizas",
      {},
      platform.env,
    );
    expect(unknown.status).toBe(404);

    const extensions = (await (
      await app(tenant).request(
        "http://localhost/api/extensions",
        {},
        platform.env,
      )
    ).json()) as any;
    expect(
      extensions.data.find((row: any) => row.manifest.id === "custom.demo")
        .widgets,
    ).toEqual([
      { id: "resumen", collection: "polizas", title: { es: "Resumen" } },
    ]);
  });
});

const ECHO_ARTIFACT = new URL(
  "../../../dist/plugin-store/custom.http-echo-1.0.0.store.zip",
  import.meta.url,
);

// Requiere `pnpm store:pack store-ports/http-echo`. En CI sin artefacto se omite.
const hasEchoArtifact = existsSync(ECHO_ARTIFACT);
const maybeEcho = hasEchoArtifact ? it : it.skip;

describe("port real custom.http-echo", () => {
  const echoFetch = globalThis.fetch;
  maybeEcho(
    "sube el ZIP empaquetado y ejecuta la acción http de punta a punta.",
    async () => {
      const tenant = "store-http-echo";
      const zip = readFileSync(ECHO_ARTIFACT);
      const form = new FormData();
      form.set(
        "file",
        new File([zip as BlobPart], "echo.store.zip", {
          type: "application/zip",
        }),
      );
      const uploaded = await app(tenant).request(
        "http://localhost/api/plugin-store/upload",
        { method: "POST", body: form },
        platform.env,
      );
      expect(uploaded.status, await uploaded.text()).toBe(200);
      await api(tenant, "/extensions/custom.http-echo/install", "POST");
      const saved = await api(
        tenant,
        "/extensions/custom.http-echo/connections/demo",
        "PUT",
        {
          connectorId: "demo",
          values: { baseUrl: "api.ejemplo.test", apiKey: "SECRETO" },
        },
      );
      expect(saved.status).toBe(204);

      globalThis.fetch = (async (url: any, init: any) => {
        expect(String(url)).toBe("https://api.ejemplo.test/eco");
        expect((init.headers as Record<string, string>)["Authorization"]).toBe(
          "Bearer SECRETO",
        );
        return Response.json({ eco: "hola", apiKey: "SECRETO" });
      }) as typeof fetch;
      try {
        const result = await api(
          tenant,
          "/extensions/custom.http-echo/actions/eco",
          "POST",
          { connectionId: "demo", input: { mensaje: "hola" } },
        );
        expect(result.status).toBe(201);
        expect(result.json.data.output).toEqual({
          status: 200,
          data: { eco: "hola" },
        });
      } finally {
        globalThis.fetch = echoFetch;
      }
    },
  );
});
