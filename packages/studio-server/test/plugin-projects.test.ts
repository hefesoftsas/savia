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
const MIB = 1024 * 1024;

function largeSourceFixture() {
  const entry = `/*${"e".repeat(1_200_000)}*/\nexport function Plugin() { return <main>Large draft</main>; }`;
  const originalModule = `/*${"o".repeat(1_100_000)}*/\nexport function Original() { return <main>Original source</main>; }`;
  const originalSource = JSON.stringify({
    "packages/large-plugin/src/plugin.tsx": originalModule,
  });
  return { entry, originalModule, originalSource };
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

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

  it("round-trips large original sources in draft storage below the D1 row limit", async () => {
    const id = "e684bf6d-ab86-42e5-ae84-2f1a3fd0b2cb";
    const { entry, originalSource } = largeSourceFixture();
    expect(byteLength(entry)).toBeGreaterThan(1_200_000);
    expect(byteLength(entry)).toBeLessThan(2 * MIB);
    expect(byteLength(originalSource)).toBeGreaterThan(1_100_000);
    expect(byteLength(originalSource)).toBeLessThan(2 * MIB);
    const draftFiles = {
      "entry.tsx": entry,
      "savia-extension.json": manifest,
      "store.json": "{}",
      "preview.json": "{}",
      "original-source.json": originalSource,
    };

    const saved = await request(
      "large-draft",
      "owner",
      `/api/plugin-projects/${id}`,
      "PUT",
      { files: draftFiles, history: [], version: 0 },
    );
    expect(saved.status, JSON.stringify(saved.body).slice(0, 500)).toBe(200);
    expect(saved.body.data.files).toEqual(draftFiles);
    const stored = await platform.env.DB.prepare(
      "SELECT files FROM plugin_authoring_projects WHERE tenant_id=? AND principal_id=? AND id=?",
    )
      .bind("large-draft", "owner", id)
      .first<{ files: string }>();
    expect(stored).toBeTruthy();
    expect(byteLength(stored!.files)).toBeLessThan(1_800_000);

    const loaded = await request(
      "large-draft",
      "owner",
      `/api/plugin-projects/${id}`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body.data.files).toEqual(draftFiles);

    const updatedFiles = {
      ...draftFiles,
      "entry.tsx": `${entry}\n// updated draft`,
    };
    const updated = await request(
      "large-draft",
      "owner",
      `/api/plugin-projects/${id}`,
      "PUT",
      { files: updatedFiles, history: [], version: 1 },
    );
    expect(updated.status, JSON.stringify(updated.body).slice(0, 500)).toBe(
      200,
    );
    expect(updated.body.data.files).toEqual(updatedFiles);
    const reloaded = await request(
      "large-draft",
      "owner",
      `/api/plugin-projects/${id}`,
    );
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.data.files).toEqual(updatedFiles);
  });

  it("recovers editable compiled entry alongside original source archive", async () => {
    const entry = "export function render(el) { el.textContent = 'compiled'; }";
    const originalSource = JSON.stringify({
      "packages/insurance-demo/src/admin.tsx":
        "export function Screen() { return <main>Original</main>; }",
      "packages/insurance-demo/src/admin.css": ".screen { color: red; }",
    });
    const parsed = await parsePluginStoreZip(
      zip([
        ["savia-extension.json", manifest],
        ["dist/plugin.js", entry],
        ["src/original-source.json", originalSource],
      ]),
    );
    expect(parsed.sourceFiles?.["entry.tsx"]).toBe(entry);
    expect(parsed.sourceFiles?.["original-source.json"]).toBe(originalSource);
    expect(parsed.sourceFiles?.["savia-extension.json"]).toContain(
      "project-test",
    );
    expect(parsed.sourceFiles?.["store.json"]).toContain("savia.store");
  });

  it("rejects malformed or unsafe original source archives", async () => {
    for (const originalSource of [
      "not json",
      JSON.stringify({ "../secret.ts": "export const secret = 1;" }),
      JSON.stringify({ "packages/demo/entry.md": "not source" }),
    ])
      await expect(
        parsePluginStoreZip(
          zip([
            ["savia-extension.json", manifest],
            ["dist/plugin.js", "export function render() {}"],
            ["src/original-source.json", originalSource],
          ]),
        ),
      ).rejects.toThrow();
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
      [
        "src/original-source.json",
        JSON.stringify({
          "packages/insurance-demo/src/admin.tsx":
            "export function Screen() {}",
        }),
      ],
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
    const recoveredBody = (await recovered.json()) as any;
    expect(recoveredBody.data.synthesized).toBe(false);
    expect(recoveredBody.data.files["entry.tsx"]).toContain("Saved source");
    expect(recoveredBody.data.files["original-source.json"]).toContain(
      "insurance-demo/src/admin.tsx",
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
    expect(oldSource.status).toBe(200);
    const oldBody = (await oldSource.json()) as {
      data: { files: Record<string, string>; synthesized?: boolean };
    };
    expect(oldBody.data.synthesized).toBe(true);
    expect(oldBody.data.files["savia-extension.json"]).toContain(
      "custom.old-project",
    );

    const compiledEntry = `/* ${"legacy compiled bundle ".repeat(6000)} */\nexport function render() {}`;
    expect(new TextEncoder().encode(compiledEntry).byteLength).toBeGreaterThan(
      100 * 1024,
    );
    const compiledZip = zip([
      [
        "savia-extension.json",
        JSON.stringify({
          ...JSON.parse(manifest),
          id: "custom.compiled-project",
        }),
      ],
      ["dist/plugin.js", compiledEntry],
    ]);
    const compiledForm = new FormData();
    compiledForm.set(
      "file",
      new File([compiledZip as BlobPart], "compiled.zip"),
    );
    expect(
      (
        await sourceApp.request(
          "http://localhost/api/plugin-store/upload",
          { method: "POST", body: compiledForm },
          platform.env,
        )
      ).status,
    ).toBe(200);
    const compiledSource = await sourceApp.request(
      "http://localhost/api/plugin-store/custom.compiled-project/source?version=1.0.0",
      {},
      platform.env,
    );
    expect(compiledSource.status).toBe(200);
    const compiledBody = (await compiledSource.json()) as {
      data: {
        files: Record<string, string>;
        synthesized?: boolean;
        sourceKind?: string;
      };
    };
    expect(compiledBody.data.synthesized).toBe(true);
    expect(compiledBody.data.sourceKind).toBe("compiled");
    expect(compiledBody.data.files["entry.tsx"]).toBe(compiledEntry);
    expect(compiledBody.data.files["entry.tsx"]).not.toContain("Counter:");

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

  it("stores and dedupes large original-source archives without exceeding D1 row limits", async () => {
    const tenant = "large-store-source";
    const { entry, originalModule, originalSource } = largeSourceFixture();
    const largeManifest = JSON.stringify({
      ...JSON.parse(manifest),
      id: "custom.large-source",
    });
    const makeZip = (sourceArchive: string) =>
      zip([
        ["savia-extension.json", largeManifest],
        ["dist/plugin.js", "export function render() {}"],
        ["src/entry.tsx", entry],
        ["src/preview.json", "{}"],
        ["src/original-source.json", sourceArchive],
      ]);
    const sourceZip = makeZip(originalSource);
    expect(byteLength(entry)).toBeGreaterThan(1_200_000);
    expect(byteLength(originalSource)).toBeGreaterThan(1_100_000);

    const upload = async (archive: Uint8Array) => {
      const form = new FormData();
      form.set(
        "file",
        new File([archive as BlobPart], "large-source.zip", {
          type: "application/zip",
        }),
      );
      return app(tenant, "admin").request(
        "http://localhost/api/plugin-store/upload",
        { method: "POST", body: form },
        platform.env,
      );
    };

    const first = await upload(sourceZip);
    expect(first.status, (await first.text()).slice(0, 500)).toBe(200);
    const duplicate = await upload(sourceZip);
    expect(duplicate.status).toBe(200);
    expect(((await duplicate.json()) as any).data.deduped).toBe(true);

    const stored = await platform.env.DB.prepare(
      "SELECT files FROM plugin_store_sources WHERE tenant_id=? AND id=? AND version=?",
    )
      .bind(tenant, "custom.large-source", "1.0.0")
      .first<{ files: string }>();
    expect(stored).toBeTruthy();
    expect(byteLength(stored!.files)).toBeLessThan(1_800_000);

    const recovered = await app(tenant, "admin").request(
      "http://localhost/api/plugin-store/custom.large-source/source?version=1.0.0",
      {},
      platform.env,
    );
    expect(recovered.status).toBe(200);
    const recoveredBody = (await recovered.json()) as any;
    expect(recoveredBody.data.files["entry.tsx"]).toBe(entry);
    expect(recoveredBody.data.files["original-source.json"]).toBe(
      originalSource,
    );
    expect(
      JSON.parse(recoveredBody.data.files["original-source.json"])[
        "packages/large-plugin/src/plugin.tsx"
      ],
    ).toBe(originalModule);

    const changedOriginal = makeZip(
      originalSource.replace("Original source", "Changed original"),
    );
    expect((await upload(changedOriginal)).status).toBe(409);
  });
});
