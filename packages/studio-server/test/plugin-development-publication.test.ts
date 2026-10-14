import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { publishPluginDevelopment } from "../src/plugin-development-publication";
import { loadPluginCheckout } from "../src/plugin-development-snapshot";
import {
  parsePluginStoreZip,
  persistParsedStoreArtifact,
  sha256Hex,
} from "../src/plugin-store";
import { encodeStoredZip } from "../../../apps/admin/src/features/studio-engine/plugin-ide-zip";
import {
  developmentFixture,
  seedDevelopmentArtifact,
  manifest,
  fullAccess,
} from "./plugin-development-fixtures";
import type { PluginPublicationRequest } from "@savia/studio-shared/plugin-development";
let f: Awaited<ReturnType<typeof developmentFixture>>;
let tenant = 100;
let scope: {
  tenantId: string;
  principalId: string;
  canManageExtension: () => boolean;
};
let input: PluginPublicationRequest;
const source = 'export function render(el) { el.textContent="Source"; }';
const files = {
  "entry.tsx": source,
  "savia-extension.json": JSON.stringify(manifest),
  "store.json": "{}",
  "preview.json": "{}",
};
function zip(version = "1.1.0", id = manifest.id, text = source) {
  return encodeStoredZip([
    {
      name: "savia-extension.json",
      data: JSON.stringify({ ...manifest, id, version }),
    },
    {
      name: "dist/plugin.js",
      data: 'export function render(el) { el.textContent="Compiled"; }',
    },
    { name: "src/entry.tsx", data: text },
  ]);
}
beforeAll(async () => {
  f = await developmentFixture();
});
afterAll(async () => {
  await f?.dispose();
});
afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => {
  scope = {
    tenantId: `tenant:${++tenant}`,
    principalId: "author",
    canManageExtension: () => true,
  };
  await seedDevelopmentArtifact(f.db, scope.tenantId);
  await f.db
    .prepare(
      "INSERT INTO plugin_store_sources(tenant_id,id,version,files) VALUES(?,?,?,?)",
    )
    .bind(scope.tenantId, manifest.id, "1.0.0", JSON.stringify(files))
    .run();
  const checkout = await loadPluginCheckout(f.db, scope, manifest.id, "1.0.0");
  input = {
    mode: "create",
    destination: "tenant",
    pluginId: manifest.id,
    version: "1.1.0",
    sourceVersion: "1.0.0",
    sourceSha256: checkout.sourceSha256,
    expectedHead: checkout.head,
  };
});
async function versions() {
  return (
    await f.db
      .prepare(
        "SELECT version FROM plugin_store_artifacts WHERE tenant_id=? AND id=? ORDER BY version",
      )
      .bind(scope.tenantId, manifest.id)
      .all<{ version: string }>()
  ).results.map((r) => r.version);
}
describe("guarded native plugin publication", () => {
  it("publishes a higher immutable tenant release without activating it", async () => {
    const bytes = zip();
    const receipt = await publishPluginDevelopment(
      f.db,
      scope,
      input,
      bytes,
      {},
    );
    expect(receipt).toMatchObject({
      state: "published",
      destination: "tenant",
      local: {
        pluginId: manifest.id,
        version: "1.1.0",
        sha256: await sha256Hex(bytes),
      },
      head: { version: "1.1.0" },
      sharedHead: null,
      issues: [],
    });
    expect(await versions()).toEqual(["1.0.0", "1.1.0"]);
    expect(
      (
        await f.db
          .prepare(
            "SELECT id FROM studio_extension_installations WHERE tenant_id=?",
          )
          .bind(scope.tenantId)
          .all()
      ).results,
    ).toEqual([]);
  });
  it("rejects changed head, source, lower versions, wrong IDs and missing source before mutation", async () => {
    for (const [patch, bytes] of [
      [
        { expectedHead: { ...input.expectedHead, sha256: "b".repeat(64) } },
        zip(),
      ],
      [{ sourceSha256: "c".repeat(64) }, zip()],
      [{ version: "1.0.0" }, zip("1.0.0")],
      [{}, zip("1.1.0", "custom.other")],
      [{ sourceVersion: "0.9.0" }, zip()],
    ] as const)
      await expect(
        publishPluginDevelopment(
          f.db,
          scope,
          { ...input, ...patch },
          bytes,
          {},
        ),
      ).rejects.toThrow();
    expect(await versions()).toEqual(["1.0.0"]);
  });
  it("rechecks management permission before persistence", async () => {
    let checks = 0;
    await expect(
      publishPluginDevelopment(
        f.db,
        { ...scope, canManageExtension: () => ++checks === 1 },
        input,
        zip(),
        {},
      ),
    ).rejects.toThrow();
    expect(await versions()).toEqual(["1.0.0"]);
  });
  it("rolls back both rows when a browser upload wins after preflight", async () => {
    let raced = false;
    let guarded = false;
    const db = new Proxy(f.db, {
      get(target, key) {
        if (key === "prepare")
          return (sql: string) => {
            if (sql.includes("studio_write_guards")) guarded = true;
            return target.prepare(sql);
          };
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (!raced && guarded) {
              raced = true;
              await persistParsedStoreArtifact(
                target,
                scope.tenantId,
                "browser",
                await parsePluginStoreZip(zip("1.0.1")),
              );
            }
            return target.batch(statements);
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      publishPluginDevelopment(db, scope, input, zip(), {}),
    ).rejects.toThrow();
    expect(raced).toBe(true);
    expect(await versions()).toEqual(["1.0.0", "1.0.1"]);
    const rows = await f.db
      .prepare(
        "SELECT version FROM plugin_store_sources WHERE tenant_id=? AND id=? ORDER BY version",
      )
      .bind(scope.tenantId, manifest.id)
      .all<{ version: string }>();
    expect(rows.results.map((r) => r.version)).toEqual(["1.0.0", "1.0.1"]);
  });
  it("returns the retained local receipt on remote failure and retries the exact ZIP", async () => {
    const registry = {
      url: "https://registry.test",
      token: "reader",
      publishToken: "private-publisher",
    };
    let failRemote = true;
    const bytes = zip();
    vi.stubGlobal(
      "fetch",
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "PUT")
          return Response.json({ data: [], cursor: null });
        if (failRemote)
          return new Response("private-publisher internal detail", {
            status: 503,
          });
        return Response.json({
          data: {
            id: manifest.id,
            version: "1.1.0",
            label: "Example",
            sha256: "d".repeat(64),
            sizeBytes: bytes.length,
            createdAt: "2026-10-12",
          },
          deduped: true,
        });
      },
    );
    const publication = { ...input, destination: "shared" as const };
    const receipt = await publishPluginDevelopment(
      f.db,
      scope,
      publication,
      bytes,
      { pluginRegistry: registry },
    );
    expect(receipt.state).toBe("shared-pending");
    expect(receipt.local.sha256).toBe(await sha256Hex(bytes));
    expect(JSON.stringify(receipt)).not.toContain("private-publisher");
    failRemote = false;
    const retry = await publishPluginDevelopment(
      f.db,
      scope,
      { ...publication, mode: "retry-shared" },
      bytes,
      { pluginRegistry: registry },
    );
    expect(retry).toMatchObject({
      state: "published",
      shared: { sha256: "d".repeat(64) },
    });
    expect(await versions()).toEqual(["1.0.0", "1.1.0"]);
    await expect(
      publishPluginDevelopment(
        f.db,
        scope,
        { ...publication, mode: "retry-shared" },
        zip("1.1.0", manifest.id, source + "\n"),
        { pluginRegistry: registry },
      ),
    ).rejects.toThrow();
  });
  it("recovers a lost tenant response using the exact immutable artifact without a second version", async () => {
    const bytes = zip();
    await publishPluginDevelopment(f.db, scope, input, bytes, {});
    expect(
      (await publishPluginDevelopment(f.db, scope, input, bytes, {})).state,
    ).toBe("published");
    expect(await versions()).toEqual(["1.0.0", "1.1.0"]);
  });
  it("rejects an unconfigured shared publisher before local creation", async () => {
    await expect(
      publishPluginDevelopment(
        f.db,
        scope,
        { ...input, destination: "shared" },
        zip(),
        {},
      ),
    ).rejects.toThrow();
    expect(await versions()).toEqual(["1.0.0"]);
  });
  it("rejects a newer shared head before local creation", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        data: [
          {
            id: manifest.id,
            version: "2.0.0",
            label: "Example",
            sha256: "d".repeat(64),
            sizeBytes: 100,
            createdAt: "2026-10-12",
          },
        ],
        cursor: null,
      }),
    );
    await expect(
      publishPluginDevelopment(
        f.db,
        scope,
        { ...input, destination: "shared" },
        zip(),
        {
          pluginRegistry: {
            url: "https://registry.test",
            token: "reader",
            publishToken: "publisher",
          },
        },
      ),
    ).rejects.toThrow();
    expect(await versions()).toEqual(["1.0.0"]);
  });
});

it("uses exact raw source bytes in the transaction guard", async () => {
  await f.db
    .prepare(
      "UPDATE plugin_store_sources SET files=? WHERE tenant_id=? AND id=? AND version=?",
    )
    .bind(
      " \n" + JSON.stringify(files) + "\n ",
      scope.tenantId,
      manifest.id,
      "1.0.0",
    )
    .run();
  expect(
    (await publishPluginDevelopment(f.db, scope, input, zip(), {})).state,
  ).toBe("published");
});
it("serves guarded multipart publication through the narrow API", async () => {
  const form = new FormData();
  form.set("metadata", JSON.stringify(input));
  form.set(
    "file",
    new File([zip()], "plugin.zip", { type: "application/zip" }),
  );
  const response = await f.request(
    "/custom.example/publish",
    { pluginDevelopmentAccess: fullAccess, canManageExtension: () => true },
    { method: "POST", body: form },
    scope.tenantId,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    state: "published",
    local: { version: "1.1.0" },
  });
});
it("rejects mismatched route coordinates and duplicate multipart fields", async () => {
  for (const duplicate of [false, true]) {
    const form = new FormData();
    form.set(
      "metadata",
      JSON.stringify({
        ...input,
        pluginId: duplicate ? manifest.id : "custom.other",
      }),
    );
    form.set("file", new File([zip()], "plugin.zip"));
    if (duplicate) form.append("file", new File([zip()], "second.zip"));
    const response = await f.request(
      "/custom.example/publish",
      { pluginDevelopmentAccess: fullAccess, canManageExtension: () => true },
      { method: "POST", body: form },
      scope.tenantId,
    );
    expect(response.status).toBe(422);
  }
  expect(await versions()).toEqual(["1.0.0"]);
});

it.each(["source", "artifact"])(
  "refuses shared retry after retained %s deletion",
  async (kind) => {
    const registry = {
      url: "https://registry.test",
      token: "reader",
      publishToken: "publisher",
    };
    vi.stubGlobal(
      "fetch",
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "PUT"
          ? new Response(null, { status: 503 })
          : Response.json({ data: [], cursor: null }),
    );
    const publication = { ...input, destination: "shared" as const };
    expect(
      (
        await publishPluginDevelopment(f.db, scope, publication, zip(), {
          pluginRegistry: registry,
        })
      ).state,
    ).toBe("shared-pending");
    if (kind === "source")
      await f.db
        .prepare(
          "DELETE FROM plugin_store_sources WHERE tenant_id=? AND id=? AND version=?",
        )
        .bind(scope.tenantId, manifest.id, "1.0.0")
        .run();
    else
      await f.db
        .prepare(
          "DELETE FROM plugin_store_artifacts WHERE tenant_id=? AND id=? AND version=?",
        )
        .bind(scope.tenantId, manifest.id, "1.1.0")
        .run();
    await expect(
      publishPluginDevelopment(
        f.db,
        scope,
        { ...publication, mode: "retry-shared" },
        zip(),
        { pluginRegistry: registry },
      ),
    ).rejects.toThrow();
  },
);
it("retains the local release when a newer shared head prevents an older missing retry", async () => {
  const registry = {
    url: "https://registry.test",
    token: "reader",
    publishToken: "publisher",
  };
  let newer = false;
  vi.stubGlobal(
    "fetch",
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return new Response(null, { status: 503 });
      return Response.json({
        data: newer
          ? [
              {
                id: manifest.id,
                version: "2.0.0",
                label: "Example",
                sha256: "d".repeat(64),
                sizeBytes: 100,
                createdAt: "2026-10-12",
              },
            ]
          : [],
        cursor: null,
      });
    },
  );
  const publication = { ...input, destination: "shared" as const };
  expect(
    (
      await publishPluginDevelopment(f.db, scope, publication, zip(), {
        pluginRegistry: registry,
      })
    ).state,
  ).toBe("shared-pending");
  newer = true;
  const retry = await publishPluginDevelopment(
    f.db,
    scope,
    { ...publication, mode: "retry-shared" },
    zip(),
    { pluginRegistry: registry },
  );
  expect(retry).toMatchObject({
    state: "shared-conflict",
    sharedHead: { version: "2.0.0" },
    local: { version: "1.1.0" },
  });
  expect(await versions()).toEqual(["1.0.0", "1.1.0"]);
});
it("recovers a lost remote response by retrying the exact ZIP at the existing coordinate", async () => {
  const registry = {
    url: "https://registry.test",
    token: "reader",
    publishToken: "publisher",
  };
  const bytes = zip();
  let uploaded = false;
  const release = {
    id: manifest.id,
    version: "1.1.0",
    label: "Example",
    sha256: await sha256Hex(bytes),
    sizeBytes: bytes.length,
    createdAt: "2026-10-12",
  };
  vi.stubGlobal(
    "fetch",
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PUT")
        return Response.json({ data: uploaded ? [release] : [], cursor: null });
      expect(
        new Uint8Array(await new Response(init.body).arrayBuffer()),
      ).toEqual(bytes);
      if (!uploaded) {
        uploaded = true;
        throw new Error("Lost response after immutable R2 write");
      }
      return Response.json({ data: release, deduped: true });
    },
  );
  const publication = { ...input, destination: "shared" as const };
  expect(
    (
      await publishPluginDevelopment(f.db, scope, publication, bytes, {
        pluginRegistry: registry,
      })
    ).state,
  ).toBe("shared-pending");
  expect(
    (
      await publishPluginDevelopment(
        f.db,
        scope,
        { ...publication, mode: "retry-shared" },
        bytes,
        { pluginRegistry: registry },
      )
    ).state,
  ).toBe("published");
  expect(await versions()).toEqual(["1.0.0", "1.1.0"]);
});

it("bounds multipart request bytes before parsing or persisting", async () => {
  const response = await f.request(
    "/custom.example/publish",
    { pluginDevelopmentAccess: fullAccess, canManageExtension: () => true },
    {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: "x".repeat(6 * 1024 * 1024 + 64 * 1024 + 1),
    },
    scope.tenantId,
  );
  expect(response.status).toBe(413);
  expect(await versions()).toEqual(["1.0.0"]);
});
it("rolls back when selected source bytes change after preflight", async () => {
  let guarded = false,
    changed = false;
  const db = new Proxy(f.db, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => {
          if (sql.includes("studio_write_guards")) guarded = true;
          return target.prepare(sql);
        };
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (guarded && !changed) {
            changed = true;
            await target
              .prepare(
                "UPDATE plugin_store_sources SET files=? WHERE tenant_id=? AND id=? AND version=?",
              )
              .bind(
                JSON.stringify({ ...files, "entry.tsx": source + "\n" }),
                scope.tenantId,
                manifest.id,
                "1.0.0",
              )
              .run();
          }
          return target.batch(statements);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    publishPluginDevelopment(db, scope, input, zip(), {}),
  ).rejects.toThrow();
  expect(changed).toBe(true);
  expect(await versions()).toEqual(["1.0.0"]);
});

it("rejects an eleventh native release before committing while retaining readable history", async () => {
  for (let n = 1; n < 10; n++)
    await seedDevelopmentArtifact(f.db, scope.tenantId, `1.0.${n}`);
  const checkout = await loadPluginCheckout(f.db, scope, manifest.id, "1.0.0");
  await expect(
    publishPluginDevelopment(
      f.db,
      scope,
      { ...input, expectedHead: checkout.head },
      zip(),
      fullAccess,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(await versions()).toHaveLength(10);
  expect(
    (await loadPluginCheckout(f.db, scope, manifest.id, "1.0.0")).head.version,
  ).toBe("1.0.9");
});

it("retains local creation when permission is removed before shared publication and safely recovers after restoration", async () => {
  let checks = 0,
    puts = 0;
  const bytes = zip();
  const registry = {
    url: "https://registry.test",
    token: "reader",
    publishToken: "publisher",
  };
  vi.stubGlobal(
    "fetch",
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PUT")
        return Response.json({ data: [], cursor: null });
      puts++;
      return Response.json({
        data: {
          id: manifest.id,
          version: "1.1.0",
          label: "Example",
          sha256: "d".repeat(64),
          sizeBytes: bytes.length,
          createdAt: "2026-10-12",
        },
        deduped: true,
      });
    },
  );
  const request = { ...input, destination: "shared" as const };
  await expect(
    publishPluginDevelopment(
      f.db,
      { ...scope, canManageExtension: () => ++checks <= 2 },
      request,
      bytes,
      { pluginRegistry: registry },
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(await versions()).toEqual(["1.0.0", "1.1.0"]);
  expect(puts).toBe(0);
  const result = await publishPluginDevelopment(f.db, scope, request, bytes, {
    pluginRegistry: registry,
  });
  expect(result.state).toBe("published");
  expect(result.local.sha256).toBe(await sha256Hex(bytes));
  expect(await versions()).toEqual(["1.0.0", "1.1.0"]);
  expect(puts).toBe(1);
});
