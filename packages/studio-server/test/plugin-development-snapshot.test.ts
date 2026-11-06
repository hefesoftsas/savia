import { getPluginRegistryHead } from "../src/plugin-registry";
import { beforeAll, afterAll, afterEach, vi, expect, it } from "vitest";
import {
  loadPluginCheckout,
  readPublicationSnapshot,
} from "../src/plugin-development-snapshot";
import {
  developmentFixture,
  seedDevelopmentArtifact,
  manifest,
} from "./plugin-development-fixtures";
let f: Awaited<ReturnType<typeof developmentFixture>>;
const scope = {
  tenantId: "tenant:12",
  principalId: "author",
  canManageExtension: () => true,
};
const files = {
  "entry.tsx": "export function render() {}",
  "savia-extension.json": JSON.stringify(manifest),
  "store.json": "{}",
  "preview.json": "{}",
  "original-source.json": JSON.stringify({
    "packages/example/src/entry.tsx": "export function render() {}",
    "packages/example/src/messages.ts": "export const greeting='Hello';",
    "packages/example/src/icon.png": "data:image/png;base64,aGVsbG8=",
  }),
};
beforeAll(async () => {
  f = await developmentFixture();
  await seedDevelopmentArtifact(f.db);
  await seedDevelopmentArtifact(f.db, "tenant:12", "1.1.0");
  await f.db
    .prepare(
      "INSERT INTO plugin_store_sources(tenant_id,id,version,files) VALUES(?,?,?,?)",
    )
    .bind(scope.tenantId, manifest.id, "1.0.0", JSON.stringify(files))
    .run();
});
afterAll(async () => {
  await f?.dispose();
});
it("returns exact authored history with nested files, source digest and current head", async () => {
  const checkout = await loadPluginCheckout(f.db, scope, manifest.id, "1.0.0");
  expect(checkout).toMatchObject({
    pluginId: manifest.id,
    sourceVersion: "1.0.0",
    head: { version: "1.1.0", sha256: "a".repeat(64) },
    sharedHead: null,
    authoringKind: "authored",
    entryPath: "packages/example/src/entry.tsx",
    files,
  });
  expect(checkout.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(checkout.sourceSha256).not.toBe(checkout.head.sha256);
  const reordered = {
    ...files,
    "original-source.json": JSON.stringify(
      Object.fromEntries(
        Object.entries(JSON.parse(files["original-source.json"])).reverse(),
      ),
    ),
  };
  await f.db
    .prepare(
      "UPDATE plugin_store_sources SET files=? WHERE tenant_id=? AND id=? AND version=?",
    )
    .bind(JSON.stringify(reordered), scope.tenantId, manifest.id, "1.0.0")
    .run();
  expect(
    (await loadPluginCheckout(f.db, scope, manifest.id, "1.0.0")).sourceSha256,
  ).toBe(checkout.sourceSha256);
});
it("identifies compiled-only legacy releases without replacing their actual renderer", async () => {
  const checkout = await loadPluginCheckout(f.db, scope, manifest.id, "1.1.0");
  expect(checkout.authoringKind).toBe("compiled-only");
  expect(checkout.files["entry.tsx"]).toBe("export function render() {}");
});
it("requires an explicit coordinate and current source-management permission", async () => {
  for (const version of ["", "latest", "9.0.0"])
    await expect(
      loadPluginCheckout(f.db, scope, manifest.id, version),
    ).rejects.toThrow();
  await expect(
    loadPluginCheckout(
      f.db,
      { ...scope, tenantId: "tenant:13" },
      manifest.id,
      "1.0.0",
    ),
  ).rejects.toThrow();
  await expect(
    loadPluginCheckout(
      f.db,
      { ...scope, canManageExtension: () => false },
      manifest.id,
      "1.0.0",
    ),
  ).rejects.toThrow();
});
it("rejects unavailable original assets and does not synthesize authored code after deletion", async () => {
  const broken = {
    ...files,
    "original-source.json": JSON.stringify({
      "entry.tsx": "import icon from './icon.png'; export function render() {}",
    }),
  };
  await f.db
    .prepare(
      "UPDATE plugin_store_sources SET files=? WHERE tenant_id=? AND id=? AND version=?",
    )
    .bind(JSON.stringify(broken), scope.tenantId, manifest.id, "1.0.0")
    .run();
  await expect(
    loadPluginCheckout(f.db, scope, manifest.id, "1.0.0"),
  ).rejects.toThrow("asset");
  await f.db
    .prepare(
      "DELETE FROM plugin_store_sources WHERE tenant_id=? AND id=? AND version=?",
    )
    .bind(scope.tenantId, manifest.id, "1.0.0")
    .run();
  expect(
    (await loadPluginCheckout(f.db, scope, manifest.id, "1.0.0")).authoringKind,
  ).toBe("compiled-only");
  await f.db
    .prepare(
      "DELETE FROM plugin_store_artifacts WHERE tenant_id=? AND id=? AND version=?",
    )
    .bind(scope.tenantId, manifest.id, "1.0.0")
    .run();
  await expect(
    loadPluginCheckout(f.db, scope, manifest.id, "1.0.0"),
  ).rejects.toThrow();
});
it("preserves raw source storage bytes for later transaction guards", async () => {
  const raw =
    ' { "entry.tsx": "export function render() {}", "savia-extension.json": ' +
    JSON.stringify(files["savia-extension.json"]) +
    ', "store.json": "{}", "preview.json": "{}" } ';
  await f.db
    .prepare(
      "INSERT INTO plugin_store_sources(tenant_id,id,version,files) VALUES(?,?,?,?)",
    )
    .bind(scope.tenantId, manifest.id, "1.1.0", raw)
    .run();
  const snapshot = await readPublicationSnapshot(
    f.db,
    scope.tenantId,
    manifest.id,
  );
  expect(snapshot.sources).toContainEqual({ version: "1.1.0", files: raw });
  expect(snapshot.head).toEqual({ version: "1.1.0", sha256: "a".repeat(64) });
});

it("serves the exact-version snapshot through the narrow checkout route", async () => {
  const response = await f.request("/custom.example/checkout?version=1.1.0", {
    pluginDevelopmentAccess: {
      workspaceLabel: "Workspace",
      read: true,
      publish: false,
    },
    canManageExtension: () => true,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    sourceVersion: "1.1.0",
    authoringKind: "authored",
    entryPath: "entry.tsx",
  });
});

it("rejects deletion after the source snapshot instead of returning a stale editable checkout", async () => {
  let batches = 0;
  const db = new Proxy(f.db, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (++batches === 1)
            await target
              .prepare(
                "DELETE FROM plugin_store_sources WHERE tenant_id=? AND id=? AND version=?",
              )
              .bind(scope.tenantId, manifest.id, "1.1.0")
              .run();
          return result;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    loadPluginCheckout(db, scope, manifest.id, "1.1.0"),
  ).rejects.toThrow("changed");
});

afterEach(() => vi.unstubAllGlobals());
it("reads a semantic shared head across bounded registry pages", async () => {
  let page = 0;
  vi.stubGlobal("fetch", async () =>
    Response.json({
      data: [
        {
          id: manifest.id,
          version: ++page === 1 ? "9.0.0" : "10.0.0",
          label: "Example",
          sha256: "b".repeat(64),
          sizeBytes: 100,
          createdAt: "2026-10-12",
        },
      ],
      cursor: page === 1 ? "second" : null,
    }),
  );
  expect(
    await getPluginRegistryHead(
      { url: "https://registry.test", token: "reader" },
      manifest.id,
    ),
  ).toEqual({ version: "10.0.0", sha256: "b".repeat(64) });
});
it("does not interpret an unavailable registry as an empty shared store", async () => {
  vi.stubGlobal(
    "fetch",
    async () => new Response("private backend details", { status: 503 }),
  );
  await expect(
    getPluginRegistryHead(
      { url: "https://registry.test", token: "reader" },
      manifest.id,
    ),
  ).rejects.toThrow("unavailable");
});
