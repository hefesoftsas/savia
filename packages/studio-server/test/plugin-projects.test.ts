import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { createStudioApp } from "../src/index";
import { parsePluginStoreZip } from "../src/plugin-store";
import { migrationStatements } from "./migration-statements";

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;

const encoder = new TextEncoder();

function zip(files: Array<[string, string]>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [filename, value] of files) {
    const name = encoder.encode(filename);
    const data = encoder.encode(value);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const directory = new DataView(new ArrayBuffer(46));
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    directory.setUint16(6, 20, true);
    directory.setUint32(20, data.length, true);
    directory.setUint32(24, data.length, true);
    directory.setUint16(28, name.length, true);
    directory.setUint32(42, offset, true);
    central.push(new Uint8Array(directory.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + 22);
  let cursor = 0;
  for (const part of [...chunks, ...central, new Uint8Array(end.buffer)]) {
    result.set(part, cursor);
    cursor += part.length;
  }
  return result;
}

const manifest = JSON.stringify({
  format: "savia.extension",
  formatVersion: 1,
  id: "custom.project-test",
  version: "1.0.0",
  label: "Project test",
  description: "Test plugin.",
  requires: [],
  apiVersion: 1,
});

function app(tenant: string, principalId: string, canManageExtension = true) {
  return createStudioApp(tenant, {
    seedObjects: [],
    principalId,
    canManageExtension: () => canManageExtension,
  });
}

async function request(
  tenant: string,
  principalId: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const response = await app(tenant, principalId).request(
    `http://localhost${path}`,
    {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    platform.env,
  );
  return { status: response.status, body: (await response.json()) as any };
}

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const filename of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    for (const statement of migrationStatements(
      readFileSync(`migrations/${filename}`, "utf8"),
    ))
      await platform.env.DB.prepare(statement).run();
});

afterAll(async () => {
  await platform?.dispose();
});

describe("durable plugin projects and release source", () => {
  const projectId = "10f31e69-9889-4cf2-920c-0d9cce070691";
  const files = {
    "entry.tsx": "export default (",
    "savia-extension.json": "{ invalid draft json",
    "store.json": "{",
    "preview.json": "{}",
  };

  it("scopes projects by tenant and principal and enforces version CAS", async () => {
    const first = await request(
      "projects-a",
      "principal-a",
      `/api/plugin-projects/${projectId}`,
      "PUT",
      {
        files,
        history: [{ role: "user", content: "Create a panel" }],
        version: 0,
      },
    );
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(1);
    expect(first.body.data.files).toEqual(files);

    const next = await request(
      "projects-a",
      "principal-a",
      `/api/plugin-projects/${projectId}`,
      "PUT",
      {
        files: { ...files, "entry.tsx": "// saved again" },
        history: [],
        version: 1,
      },
    );
    expect(next.status).toBe(200);
    expect(next.body.data.version).toBe(2);

    const stale = await request(
      "projects-a",
      "principal-a",
      `/api/plugin-projects/${projectId}`,
      "PUT",
      {
        files,
        history: [],
        version: 1,
      },
    );
    expect(stale.status).toBe(409);
    expect(
      (await request("projects-a", "principal-b", "/api/plugin-projects")).body
        .data,
    ).toEqual([]);
    expect(
      (await request("projects-b", "principal-a", "/api/plugin-projects")).body
        .data,
    ).toEqual([]);
    expect(
      (
        await request(
          "projects-a",
          "principal-b",
          `/api/plugin-projects/${projectId}`,
        )
      ).status,
    ).toBe(404);
  });

  it("denies unauthenticated and non-admin project access", async () => {
    const unauthenticated = await createStudioApp("projects-auth", {
      seedObjects: [],
    }).request("http://localhost/api/plugin-projects", {}, platform.env);
    expect(unauthenticated.status).toBe(401);
    const denied = await createStudioApp("projects-auth", {
      seedObjects: [],
      principalId: "reader",
      canManageExtension: () => false,
    }).request("http://localhost/api/plugin-projects", {}, platform.env);
    expect(denied.status).toBe(403);
  });

  it("deletes only the owner's current project version", async () => {
    const id = "c6f5482c-307b-4caf-8cf6-d4bc7adbb561";
    const saved = await request(
      "project-delete",
      "owner",
      `/api/plugin-projects/${id}`,
      "PUT",
      {
        files,
        history: [],
        version: 0,
      },
    );
    expect(saved.status).toBe(200);
    const otherOwner = await app("project-delete", "other").request(
      `http://localhost/api/plugin-projects/${id}?version=1`,
      { method: "DELETE" },
      platform.env,
    );
    expect(otherOwner.status).toBe(404);
    const stale = await app("project-delete", "owner").request(
      `http://localhost/api/plugin-projects/${id}?version=2`,
      { method: "DELETE" },
      platform.env,
    );
    expect(stale.status).toBe(409);
    const removed = await app("project-delete", "owner").request(
      `http://localhost/api/plugin-projects/${id}?version=1`,
      { method: "DELETE" },
      platform.env,
    );
    expect(removed.status).toBe(204);
    expect(
      (await request("project-delete", "owner", `/api/plugin-projects/${id}`))
        .status,
    ).toBe(404);
  });

  it("stores source with the artifact and returns it only for releases that have it", async () => {
    const sourceZip = zip([
      ["savia-extension.json", manifest],
      ["dist/plugin.js", "export function render() {}"],
      [
        "src/entry.tsx",
        "export function Plugin() { return <main>Saved source</main>; }",
      ],
      ["src/preview.json", '{"collections":{},"settings":{}}'],
    ]);
    const parsed = await parsePluginStoreZip(sourceZip);
    expect(parsed.sourceFiles?.["entry.tsx"]).toContain("Saved source");
    const form = new FormData();
    form.set(
      "file",
      new File([sourceZip as BlobPart], "source.zip", {
        type: "application/zip",
      }),
    );
    const sourceApp = app("source-tenant", "admin");
    const uploaded = await sourceApp.request(
      "http://localhost/api/plugin-store/upload",
      { method: "POST", body: form },
      platform.env,
    );
    expect(uploaded.status).toBe(200);
    const installed = await sourceApp.request(
      "http://localhost/api/extensions/custom.project-test/install",
      { method: "POST", headers: { "content-type": "application/json" } },
      platform.env,
    );
    expect(installed.status).toBe(200);
    const entry = await sourceApp.request(
      "http://localhost/api/plugin-store/custom.project-test/entry",
      {},
      platform.env,
    );
    expect(entry.status).toBe(200);
    expect(await entry.text()).toContain("export function render()");
    const recovered = await sourceApp.request(
      "http://localhost/api/plugin-store/custom.project-test/source?version=1.0.0",
      {},
      platform.env,
    );
    expect(recovered.status).toBe(200);
    expect(((await recovered.json()) as any).data.files["entry.tsx"]).toContain(
      "Saved source",
    );

    const changedSourceZip = zip([
      ["savia-extension.json", manifest],
      ["dist/plugin.js", "export function render() {}"],
      [
        "src/entry.tsx",
        "export function Plugin() { return <main>Changed</main>; }",
      ],
      ["src/preview.json", '{"collections":{},"settings":{}}'],
    ]);
    const changedForm = new FormData();
    changedForm.set(
      "file",
      new File([changedSourceZip as BlobPart], "changed.zip"),
    );
    const changed = await sourceApp.request(
      "http://localhost/api/plugin-store/upload",
      { method: "POST", body: changedForm },
      platform.env,
    );
    expect(changed.status).toBe(409);

    const oldZip = zip([
      [
        "savia-extension.json",
        JSON.stringify({ ...JSON.parse(manifest), id: "custom.old-project" }),
      ],
      ["dist/plugin.js", "export function render() {}"],
    ]);
    const oldForm = new FormData();
    oldForm.set("file", new File([oldZip as BlobPart], "old.zip"));
    const oldUpload = await sourceApp.request(
      "http://localhost/api/plugin-store/upload",
      { method: "POST", body: oldForm },
      platform.env,
    );
    expect(oldUpload.status).toBe(200);
    const oldSource = await sourceApp.request(
      "http://localhost/api/plugin-store/custom.old-project/source?version=1.0.0",
      {},
      platform.env,
    );
    expect(oldSource.status).toBe(404);

    const disabled = await sourceApp.request(
      "http://localhost/api/extensions/custom.project-test",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
      platform.env,
    );
    expect(disabled.status).toBe(200);
    const removed = await sourceApp.request(
      "http://localhost/api/plugin-store/custom.project-test?version=1.0.0",
      { method: "DELETE" },
      platform.env,
    );
    expect(removed.status).toBe(200);
    const deletedSource = await sourceApp.request(
      "http://localhost/api/plugin-store/custom.project-test/source?version=1.0.0",
      {},
      platform.env,
    );
    expect(deletedSource.status).toBe(404);
  });
});
