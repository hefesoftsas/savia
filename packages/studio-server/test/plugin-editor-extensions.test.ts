import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Hono } from "hono";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { migrationStatements } from "./migration-statements";
import { registerPluginEditorExtensions } from "../src/plugin-editor-extensions";
import type { Env } from "../src/context";

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; FILES: R2Bucket }>>
>;
const encoder = new TextEncoder();
function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function zip(files: Array<[string, Uint8Array]>) {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = encoder.encode(path);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    local.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const part of [...local, ...central, new Uint8Array(end.buffer)]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
function vsix(
  name = "example",
  browserSource = "export function activate() {}",
  publisher = "Acme",
) {
  const manifest = {
    publisher,
    name,
    version: "1.0.0",
    license: "MIT",
    engines: { vscode: "^1.138.0" },
    browser: "browser.js",
  };
  return zip([
    ["extension/package.json", encoder.encode(JSON.stringify(manifest))],
    ["extension/browser.js", encoder.encode(browserSource)],
  ]);
}
function app(
  principalId: string,
  allowed = true,
  tenantId = "tenant-editor-test",
) {
  const hono = new Hono<Env>();
  hono.use("*", async (c, next) => {
    c.set("tenant", tenantId);
    c.set("principalId", principalId);
    await next();
  });
  registerPluginEditorExtensions(hono, {
    canManageExtension: async () => allowed,
  });
  return hono;
}
async function req(
  principal: string,
  path: string,
  init: RequestInit = {},
  allowed = true,
  tenantId = "tenant-editor-test",
) {
  const response = await app(principal, allowed, tenantId).request(
    `http://localhost${path}`,
    init,
    platform.env,
  );
  const contentType = response.headers.get("content-type") ?? "";
  return {
    response,
    body: contentType.includes("json")
      ? ((await response.json()) as any)
      : await response.arrayBuffer(),
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
    for (const statement of migrationStatements(
      readFileSync(`migrations/${file}`, "utf8"),
    ))
      await platform.env.DB.prepare(statement).run();
});
afterAll(async () => {
  await platform?.dispose();
});
afterEach(() => vi.unstubAllGlobals());

describe("scoped editor extension installation API", () => {
  it("supports authenticated popular browsing without q and keeps search validation", async () => {
    const requests: URL[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requests.push(new URL(String(input)));
      return new Response(JSON.stringify({ totalSize: 2, extensions: [] }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const path = "/api/plugin-editor-extensions/marketplace";

    const missingQuery = await req("browse-user", path);
    expect(missingQuery.response.status).toBe(200);
    const blankQuery = await req("browse-user", `${path}?q=%20%20&offset=20`);
    expect(blankQuery.response.status).toBe(200);
    const search = await req("browse-user", `${path}?q=prettier&offset=0`);
    expect(search.response.status).toBe(200);

    expect(requests).toHaveLength(3);
    for (const url of requests.slice(0, 2)) {
      expect(url.searchParams.has("query")).toBe(false);
      expect(url.searchParams.get("sortBy")).toBe("downloadCount");
      expect(url.searchParams.get("sortOrder")).toBe("desc");
    }
    expect(requests[0].searchParams.get("offset")).toBe("0");
    expect(requests[1].searchParams.get("offset")).toBe("20");
    expect(requests[2].searchParams.get("query")).toBe("prettier");
    expect(requests[2].searchParams.has("sortBy")).toBe(false);
    expect(requests[2].searchParams.has("sortOrder")).toBe(false);

    const denied = await req("browse-denied", path, {}, false);
    expect(denied.response.status).toBe(403);
    const overlong = await req("browse-user", `${path}?q=${"q".repeat(201)}`);
    expect(overlong.response.status).toBe(400);
    const invalidOffset = await req("browse-user", `${path}?offset=-1`);
    expect(invalidOffset.response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects native Open VSX targets and incompatible manifests before downloading a VSIX", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/Acme/native/1.2.3")
        return new Response(
          JSON.stringify({
            ...{
              namespace: "Acme",
              name: "native",
              version: "1.2.3",
              files: { download: "/api/Acme/native/1.2.3/file/download" },
            },
            targetPlatform: "alpine-arm64",
          }),
          { headers: { "content-type": "application/json" } },
        );
      if (url.pathname === "/api/Acme/incompatible/1.2.3")
        return new Response(
          JSON.stringify({
            namespace: "Acme",
            name: "incompatible",
            version: "1.2.3",
            files: {
              download: "/api/Acme/incompatible/1.2.3/file/download",
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      if (url.pathname.endsWith("/file/package.json"))
        return new Response(
          JSON.stringify({
            publisher: "Acme",
            name: "incompatible",
            version: "1.2.3",
            engines: { vscode: "^2.0.0" },
            browser: "browser.js",
          }),
          { headers: { "content-type": "application/json" } },
        );
      return new Response(new Uint8Array([0x50, 0x4b, 3, 4]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const inspect = (publisher: string, name: string) =>
      req("preflight-user", "/api/plugin-editor-extensions/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "open-vsx",
          publisher,
          name,
          version: "1.2.3",
        }),
      });

    const native = await inspect("Acme", "native");
    expect(native.response.status).toBe(422);
    expect(new TextDecoder().decode(native.body)).toMatch(/platform|web/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const incompatible = await inspect("Acme", "incompatible");
    expect(incompatible.response.status).toBe(422);
    expect(new TextDecoder().decode(incompatible.body)).toMatch(
      /VS Code|unsupported/i,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns a clear 413 when an Open VSX VSIX exceeds the package limit", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/Acme/large/1.2.3")
        return new Response(
          JSON.stringify({
            namespace: "Acme",
            name: "large",
            version: "1.2.3",
            files: { download: "/api/Acme/large/1.2.3/file/download" },
          }),
          { headers: { "content-type": "application/json" } },
        );
      if (url.pathname.endsWith("/file/package.json"))
        return new Response(
          JSON.stringify({
            publisher: "Acme",
            name: "large",
            version: "1.2.3",
            engines: { vscode: "^1.138.0" },
            browser: "browser.js",
          }),
          { headers: { "content-type": "application/json" } },
        );
      return new Response(null, {
        headers: { "content-length": String(20 * 1024 * 1024 + 1) },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await req(
      "large-user",
      "/api/plugin-editor-extensions/inspect",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "open-vsx",
          publisher: "Acme",
          name: "large",
          version: "1.2.3",
        }),
      },
    );
    expect(response.response.status).toBe(413);
    expect(new TextDecoder().decode(response.body)).toMatch(
      /20 MiB size limit/i,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("requires management permission and scopes installations, package reads, and deletion by principal", async () => {
    const denied = await req(
      "user-a",
      "/api/plugin-editor-extensions/installed",
      {},
      false,
    );
    expect(denied.response.status).toBe(403);
    const inspected = await req(
      "user-a",
      "/api/plugin-editor-extensions/inspect?source=vsix&fileName=acme.vsix",
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: vsix(),
      },
    );
    expect(inspected.response.status).toBe(201);
    const installed = await req(
      "user-a",
      "/api/plugin-editor-extensions/install",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inspectionId: inspected.body.inspectionId }),
      },
    );
    expect(installed.response.status).toBe(201);
    const otherList = await req(
      "user-b",
      "/api/plugin-editor-extensions/installed",
    );
    expect(otherList.body.installations).toEqual([]);
    const otherPackage = await req(
      "user-b",
      `/api/plugin-editor-extensions/installed/${installed.body.installation.installationId}/package`,
    );
    expect(otherPackage.response.status).toBe(404);
    const otherRemove = await req(
      "user-b",
      `/api/plugin-editor-extensions/installed/${installed.body.installation.installationId}`,
      { method: "DELETE" },
    );
    expect(otherRemove.response.status).toBe(404);
    const ownPackage = await req(
      "user-a",
      `/api/plugin-editor-extensions/installed/${installed.body.installation.installationId}/package`,
    );
    expect(ownPackage.response.status).toBe(200);
    expect(ownPackage.response.headers.get("x-content-sha256")).toBe(
      installed.body.installation.sha256,
    );
  });

  it("supports idempotent duplicate installation, rejects digest conflicts, and retains project references", async () => {
    const first = await req(
      "user-c",
      "/api/plugin-editor-extensions/inspect?source=vsix&fileName=one.vsix",
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: vsix("repeat"),
      },
    );
    const install = (inspectionId: string) =>
      req("user-c", "/api/plugin-editor-extensions/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inspectionId }),
      });
    const installed = await install(first.body.inspectionId);
    expect(installed.body.installation.publisher).toBe("Acme");
    const duplicateInspect = await req(
      "user-c",
      "/api/plugin-editor-extensions/inspect?source=vsix&fileName=two.vsix",
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: vsix("repeat"),
      },
    );
    const duplicate = await install(duplicateInspect.body.inspectionId);
    expect(duplicate.body.installation.installationId).toBe(
      installed.body.installation.installationId,
    );

    const changed = await req(
      "user-c",
      "/api/plugin-editor-extensions/inspect?source=vsix&fileName=changed.vsix",
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: vsix("repeat", "export function activate() { return 2; }"),
      },
    );
    const conflict = await install(changed.body.inspectionId);
    expect(conflict.response.status).toBe(409);

    const caseVariant = await req(
      "user-c",
      "/api/plugin-editor-extensions/inspect?source=vsix&fileName=case-variant.vsix",
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: vsix(
          "repeat",
          "export function activate() { return 3; }",
          "acme",
        ),
      },
    );
    const caseVariantConflict = await install(caseVariant.body.inspectionId);
    expect(caseVariantConflict.response.status).toBe(409);

    const projectId = crypto.randomUUID();
    await platform.env.DB.prepare(
      `INSERT INTO plugin_authoring_projects(tenant_id,principal_id,id,label,files,history,editor_extensions,installed_editor_extensions,version,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        "tenant-editor-test",
        "user-c",
        projectId,
        "Extension reference",
        "{}",
        "[]",
        "[]",
        JSON.stringify([
          {
            installationId: installed.body.installation.installationId,
            sha256: installed.body.installation.sha256,
          },
        ]),
        1,
        new Date().toISOString(),
      )
      .run();
    const removal = await req(
      "user-c",
      `/api/plugin-editor-extensions/installed/${installed.body.installation.installationId}`,
      { method: "DELETE" },
    );
    expect(removal.response.status).toBe(409);
    expect(removal.body.projectIds).toEqual([projectId]);
  });

  it("rejects forged and expired inspections, upload overruns, and quota races", async () => {
    const forged = await req(
      "user-d",
      "/api/plugin-editor-extensions/install",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inspectionId: crypto.randomUUID() }),
      },
    );
    expect(forged.response.status).toBe(404);
    const overrun = await req(
      "user-d",
      "/api/plugin-editor-extensions/inspect?source=vsix&fileName=large.vsix",
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array(20 * 1024 * 1024 + 1),
      },
    );
    expect(overrun.response.status).toBe(413);

    const bytesA = vsix("quota-a");
    const bytesB = vsix("quota-b");
    const quota = 128 * 1024 * 1024;
    await platform.env.DB.prepare(
      `INSERT INTO plugin_editor_extension_artifacts(tenant_id,principal_id,sha256,object_key,compressed_bytes,expanded_bytes,created_at,reference_count)
       VALUES(?,?,?,?,?,?,?,0)`,
    )
      .bind(
        "tenant-editor-quota-test",
        "quota-seed",
        "a".repeat(64),
        "quota/seed",
        quota - bytesA.byteLength - bytesB.byteLength + 1,
        1,
        new Date().toISOString(),
      )
      .run();
    const post = (bytes: Uint8Array, file: string) =>
      req(
        "quota-user",
        `/api/plugin-editor-extensions/inspect?source=vsix&fileName=${file}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: bytes,
        },
        true,
        "tenant-editor-quota-test",
      );
    const results = await Promise.all([
      post(bytesA, "a.vsix"),
      post(bytesB, "b.vsix"),
    ]);
    expect(results.map((x) => x.response.status).sort()).toEqual([201, 413]);
  });
});
