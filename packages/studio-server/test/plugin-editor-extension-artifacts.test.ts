import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { migrationStatements } from "./migration-statements";
import {
  expireEditorExtensionInspections,
  findOwnedEditorExtension,
  installStagedEditorExtension,
  listOwnedEditorExtensions,
  readOwnedEditorExtensionPackage,
  stageEditorExtensionInspection,
  uninstallOwnedEditorExtension,
} from "../src/plugin-editor-extension-artifacts";
import { EDITOR_EXTENSION_TENANT_QUOTA_BYTES } from "../src/plugin-editor-extension-artifacts";
import { PLUGIN_EDITOR_VSCODE_VERSION } from "@savia/studio-shared/plugin-editor-extensions";

let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; FILES: R2Bucket }>>
>;
const tenant = "artifact-scope-test";
const digest = "b".repeat(64);
const metadata = {
  id: "Acme.example",
  publisher: "Acme",
  name: "example",
  version: "1.0.0",
  sha256: digest,
  license: "MIT",
  compressedBytes: 12,
  expandedBytes: 24,
  dependencies: [],
  compatibility: { supported: true, reason: null },
};

const encoder = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function zip(files: Array<[string, Uint8Array]>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = encoder.encode(path);
    const crc = crc32(data);
    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true);
    localHeader.setUint16(4, 20, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, data.length, true);
    localHeader.setUint32(22, data.length, true);
    localHeader.setUint16(26, name.length, true);
    local.push(new Uint8Array(localHeader.buffer), name, data);
    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true);
    centralHeader.setUint16(4, 20, true);
    centralHeader.setUint16(6, 20, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, data.length, true);
    centralHeader.setUint32(24, data.length, true);
    centralHeader.setUint16(28, name.length, true);
    centralHeader.setUint32(42, offset, true);
    central.push(new Uint8Array(centralHeader.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((size, part) => size + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const part of [...local, ...central, new Uint8Array(end.buffer)]) {
    result.set(part, cursor);
    cursor += part.length;
  }
  return result;
}

function vsix(
  name = "example",
  extraManifest: Record<string, unknown> = {},
): Uint8Array {
  const packageJson = {
    publisher: "Acme",
    name,
    version: "1.0.0",
    license: "MIT",
    engines: { vscode: "^1.138.0" },
    browser: "browser.js",
    ...extraManifest,
  };
  return zip([
    ["extension/package.json", encoder.encode(JSON.stringify(packageJson))],
    ["extension/browser.js", encoder.encode("export function activate() {}")],
  ]);
}

async function seedRetainedPackage(
  scope: { tenantId: string; principalId: string },
  bytes: Uint8Array,
  sha256: string,
  installationId: string,
) {
  const objectKey = `plugin-editor/${scope.tenantId}/${scope.principalId}/packages/${sha256}.vsix`;
  await platform.env.FILES.put(objectKey, bytes);
  await platform.env.DB.prepare(
    `INSERT INTO plugin_editor_extension_artifacts(tenant_id,principal_id,sha256,object_key,compressed_bytes,expanded_bytes,created_at,reference_count)
     VALUES(?,?,?,?,?,?,?,1)`,
  )
    .bind(
      scope.tenantId,
      scope.principalId,
      sha256,
      objectKey,
      bytes.byteLength,
      2,
      new Date().toISOString(),
    )
    .run();
  const packageMetadata = {
    ...metadata,
    id: "Acme.example",
    publisher: "Acme",
    name: "example",
    sha256,
    compressedBytes: bytes.byteLength,
  };
  await platform.env.DB.prepare(
    `INSERT INTO plugin_editor_extension_installations(id,tenant_id,principal_id,publisher,name,version,sha256,metadata_json,source,object_key,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      installationId,
      scope.tenantId,
      scope.principalId,
      packageMetadata.publisher,
      packageMetadata.name,
      packageMetadata.version,
      sha256,
      JSON.stringify(packageMetadata),
      "vsix",
      objectKey,
      new Date().toISOString(),
    )
    .run();
  return objectKey;
}

function hookedFiles(hooks: {
  get?: (key: string) => Promise<void>;
  put?: (key: string) => Promise<void>;
  delete?: (key: string) => Promise<void>;
}): R2Bucket {
  const original = platform.env.FILES;
  return new Proxy(original, {
    get(target, property) {
      if (property === "get")
        return async (key: string) => {
          const object = await target.get(key);
          await hooks.get?.(key);
          return object;
        };
      if (property === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          const result = await target.put(...args);
          await hooks.put?.(args[0]);
          return result;
        };
      if (property === "delete")
        return async (key: string) => {
          await hooks.delete?.(key);
          return target.delete(key);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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

describe("scoped editor extension artifacts", () => {
  it("scopes installation lookup to tenant and principal and returns missing objects as missing", async () => {
    await platform.env.DB.prepare(
      `INSERT INTO plugin_editor_extension_artifacts(tenant_id,principal_id,sha256,object_key,compressed_bytes,expanded_bytes,created_at,reference_count)
       VALUES(?,?,?,?,?,?,?,1)`,
    )
      .bind(
        tenant,
        "owner",
        digest,
        "missing/object.vsix",
        12,
        24,
        new Date().toISOString(),
      )
      .run();
    await platform.env.DB.prepare(
      `INSERT INTO plugin_editor_extension_installations(id,tenant_id,principal_id,publisher,name,version,sha256,metadata_json,source,object_key,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        "install-owner",
        tenant,
        "owner",
        "Acme",
        "example",
        "1.0.0",
        digest,
        JSON.stringify(metadata),
        "vsix",
        "missing/object.vsix",
        new Date().toISOString(),
      )
      .run();
    expect(
      await findOwnedEditorExtension(platform.env.DB, {
        tenantId: tenant,
        principalId: "other",
        installationId: "install-owner",
      }),
    ).toBeNull();
    expect(
      await findOwnedEditorExtension(platform.env.DB, {
        tenantId: "other-tenant",
        principalId: "owner",
        installationId: "install-owner",
      }),
    ).toBeNull();
    expect(
      await listOwnedEditorExtensions(platform.env.DB, {
        tenantId: tenant,
        principalId: "other",
      }),
    ).toEqual([]);
    expect(
      await readOwnedEditorExtensionPackage(
        platform.env.DB,
        platform.env.FILES,
        {
          tenantId: tenant,
          principalId: "owner",
          installationId: "install-owner",
        },
      ),
    ).toBeNull();
  });

  it("expires only the caller's staged inspections and preserves cleanup rows when object deletion fails", async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    for (const [id, principal] of [
      ["expired-own", "owner"],
      ["expired-other", "other"],
    ]) {
      const objectKey = `staging/${id}`;
      await platform.env.FILES.put(objectKey, new Uint8Array([1, 2, 3]));
      await platform.env.DB.prepare(
        `INSERT INTO plugin_editor_extension_inspections(id,tenant_id,principal_id,source,metadata_json,manifest_json,object_key,created_at,expires_at,reservation_bytes)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          id,
          tenant,
          principal,
          "vsix",
          JSON.stringify(metadata),
          "{}",
          objectKey,
          expired,
          expired,
          3,
        )
        .run();
    }
    await expireEditorExtensionInspections(
      platform.env.DB,
      platform.env.FILES,
      { tenantId: tenant, principalId: "owner" },
    );
    const own = await platform.env.DB.prepare(
      "SELECT id FROM plugin_editor_extension_inspections WHERE id='expired-own'",
    ).first();
    const other = await platform.env.DB.prepare(
      "SELECT id FROM plugin_editor_extension_inspections WHERE id='expired-other'",
    ).first();
    expect(own).toBeNull();
    expect(other).not.toBeNull();
    expect(await platform.env.FILES.get("staging/expired-own")).toBeNull();
    expect(
      await platform.env.FILES.get("staging/expired-other"),
    ).not.toBeNull();

    const failingFiles = {
      delete: async () => {
        throw new Error("R2 unavailable");
      },
    } as unknown as R2Bucket;
    await platform.env.DB.prepare(
      "INSERT INTO plugin_editor_extension_cleanup(object_key,tenant_id,principal_id,created_at) VALUES(?,?,?,?)",
    )
      .bind("retry/object", tenant, "owner", new Date().toISOString())
      .run();
    const { cleanupEditorExtensionObjects } =
      await import("../src/plugin-editor-extension-artifacts");
    await cleanupEditorExtensionObjects(platform.env.DB, failingFiles, {
      tenantId: tenant,
      principalId: "owner",
    });
    const cleanup = await platform.env.DB.prepare(
      "SELECT object_key FROM plugin_editor_extension_cleanup WHERE object_key='retry/object'",
    ).first();
    expect(cleanup).not.toBeNull();
  });

  it("rejects staged package bytes that no longer match their inspected digest", async () => {
    const scope = { tenantId: "artifact-digest-check", principalId: "owner" };
    const bytes = vsix();
    const inspection = await stageEditorExtensionInspection(
      platform.env.DB,
      platform.env.FILES,
      scope,
      { bytes, source: "vsix", runtimeVersion: PLUGIN_EDITOR_VSCODE_VERSION },
    );
    const stagedKey = `plugin-editor/${scope.tenantId}/${scope.principalId}/inspections/${inspection.inspectionId}.vsix`;
    const altered = new Uint8Array(bytes);
    altered[altered.length - 1] ^= 1;
    await platform.env.FILES.put(stagedKey, altered);

    await expect(
      installStagedEditorExtension(
        platform.env.DB,
        platform.env.FILES,
        scope,
        inspection.inspectionId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await platform.env.DB.prepare(
        "SELECT 1 FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=?",
      )
        .bind(scope.tenantId, scope.principalId)
        .first(),
    ).toBeNull();
    expect(await platform.env.FILES.get(stagedKey)).toBeNull();
  });

  it("records cleanup when an inspection object is partially written", async () => {
    const scope = {
      tenantId: "artifact-stage-put-failure",
      principalId: "owner",
    };
    const input = vsix();
    let inspectionKey = "";
    const files = hookedFiles({
      put: async (key) => {
        if (!key.includes("/inspections/")) return;
        inspectionKey = key;
        throw new Error("R2 response lost after write");
      },
      delete: async (key) => {
        if (key === inspectionKey) throw new Error("R2 cleanup unavailable");
      },
    });

    await expect(
      stageEditorExtensionInspection(platform.env.DB, files, scope, {
        bytes: input,
        source: "vsix",
        runtimeVersion: PLUGIN_EDITOR_VSCODE_VERSION,
      }),
    ).rejects.toThrow("R2 response lost after write");
    expect(
      await platform.env.DB.prepare(
        "SELECT 1 FROM plugin_editor_extension_inspections WHERE tenant_id=? AND principal_id=?",
      )
        .bind(scope.tenantId, scope.principalId)
        .first(),
    ).toBeNull();
    expect(
      await platform.env.DB.prepare(
        "SELECT object_key FROM plugin_editor_extension_cleanup WHERE object_key=?",
      )
        .bind(inspectionKey)
        .first(),
    ).not.toBeNull();
  });

  it("persists a compact manifest summary instead of package-sized JSON", async () => {
    const scope = { tenantId: "artifact-large-manifest", principalId: "owner" };
    const inspection = await stageEditorExtensionInspection(
      platform.env.DB,
      platform.env.FILES,
      scope,
      {
        bytes: vsix("example", {
          description: "x".repeat(3 * 1024 * 1024),
          contributes: {
            commands: Array.from({ length: 150_000 }, (_, i) => `cmd.${i}`),
          },
        }),
        source: "vsix",
        runtimeVersion: PLUGIN_EDITOR_VSCODE_VERSION,
      },
    );
    expect(inspection.manifestSummary.description).toHaveLength(1000);
    expect(inspection.manifestSummary.contributes.commands).toEqual({
      count: 150_000,
    });
    const stored = await platform.env.DB.prepare(
      "SELECT length(manifest_json) AS size FROM plugin_editor_extension_inspections WHERE id=?",
    )
      .bind(inspection.inspectionId)
      .first<{ size: number }>();
    expect(stored?.size).toBeLessThan(8192);
  });

  it("retires an artifact incarnation before cleanup so a concurrent reinstall gets a different object key", async () => {
    const scope = {
      tenantId: "artifact-uninstall-reinstall-race",
      principalId: "owner",
    };
    const bytes = vsix();
    const firstId = "3a27a7d4-6e9f-4b93-9a42-3f1bd9e70002";
    const oldKey = await seedRetainedPackage(
      scope,
      bytes,
      await sha256(bytes),
      firstId,
    );
    const inspection = await stageEditorExtensionInspection(
      platform.env.DB,
      platform.env.FILES,
      scope,
      { bytes, source: "vsix", runtimeVersion: PLUGIN_EDITOR_VSCODE_VERSION },
    );
    let reinstalled: Awaited<
      ReturnType<typeof installStagedEditorExtension>
    > | null = null;
    let inHook = false;
    const interleavedFiles = hookedFiles({
      delete: async (key) => {
        if (key !== oldKey || inHook) return;
        inHook = true;
        reinstalled = await installStagedEditorExtension(
          platform.env.DB,
          platform.env.FILES,
          scope,
          inspection.inspectionId,
        );
      },
    });

    await expect(
      uninstallOwnedEditorExtension(platform.env.DB, interleavedFiles, {
        ...scope,
        installationId: firstId,
      }),
    ).resolves.toMatchObject({ removed: true });
    expect(reinstalled).not.toBeNull();
    const newPackage = await platform.env.DB.prepare(
      "SELECT object_key FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=? AND id=?",
    )
      .bind(scope.tenantId, scope.principalId, reinstalled!.installationId)
      .first<{ object_key: string }>();
    expect(newPackage?.object_key).not.toBe(oldKey);
    expect(await platform.env.FILES.get(newPackage!.object_key)).not.toBeNull();
    expect(await platform.env.FILES.get(oldKey)).toBeNull();
  });

  it("uses a fresh candidate when the retained artifact is uninstalled before the final batch", async () => {
    const scope = {
      tenantId: "artifact-retire-before-install-batch",
      principalId: "owner",
    };
    const bytes = vsix();
    const packageDigest = await sha256(bytes);
    const priorId = "3a27a7d4-6e9f-4b93-9a42-3f1bd9e70003";
    const oldKey = await seedRetainedPackage(
      scope,
      bytes,
      packageDigest,
      priorId,
    );
    await platform.env.DB.prepare(
      "UPDATE plugin_editor_extension_installations SET name='previous' WHERE id=?",
    )
      .bind(priorId)
      .run();
    const inspection = await stageEditorExtensionInspection(
      platform.env.DB,
      platform.env.FILES,
      scope,
      { bytes, source: "vsix", runtimeVersion: PLUGIN_EDITOR_VSCODE_VERSION },
    );
    const reservation = await platform.env.DB.prepare(
      "SELECT reservation_bytes FROM plugin_editor_extension_inspections WHERE id=?",
    )
      .bind(inspection.inspectionId)
      .first<{ reservation_bytes: number }>();
    expect(reservation?.reservation_bytes).toBe(0);
    let raced = false;
    let candidateKey = "";
    const files = hookedFiles({
      put: async (key) => {
        if (!key.includes("/packages/") || raced) return;
        candidateKey = key;
        raced = true;
        await uninstallOwnedEditorExtension(
          platform.env.DB,
          platform.env.FILES,
          {
            ...scope,
            installationId: priorId,
          },
        );
      },
    });

    const installation = await installStagedEditorExtension(
      platform.env.DB,
      files,
      scope,
      inspection.inspectionId,
    );
    const persisted = await platform.env.DB.prepare(
      "SELECT object_key FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=? AND id=?",
    )
      .bind(scope.tenantId, scope.principalId, installation.installationId)
      .first<{ object_key: string }>();
    expect(raced).toBe(true);
    expect(persisted?.object_key).toBe(candidateKey);
    expect(persisted?.object_key).not.toBe(oldKey);
    expect(await platform.env.FILES.get(candidateKey)).not.toBeNull();
    expect(await platform.env.FILES.get(oldKey)).toBeNull();
  });

  it("rechecks tenant quota at commit when an inspection's zero-byte reservation loses its retained artifact", async () => {
    const scope = { tenantId: "artifact-quota-race", principalId: "owner" };
    const bytes = vsix();
    const inspected = await stageEditorExtensionInspection(
      platform.env.DB,
      platform.env.FILES,
      scope,
      { bytes, source: "vsix", runtimeVersion: PLUGIN_EDITOR_VSCODE_VERSION },
    );
    await platform.env.DB.prepare(
      "DELETE FROM plugin_editor_extension_inspections WHERE id=?",
    )
      .bind(inspected.inspectionId)
      .run();
    const firstStagedKey = `plugin-editor/${scope.tenantId}/${scope.principalId}/inspections/${inspected.inspectionId}.vsix`;
    await platform.env.FILES.delete(firstStagedKey);
    const sha256 = inspected.metadata.sha256;
    const priorInstallationId = "3a27a7d4-6e9f-4b93-9a42-3f1bd9e70001";
    await seedRetainedPackage(scope, bytes, sha256, priorInstallationId);
    await platform.env.DB.prepare(
      "UPDATE plugin_editor_extension_installations SET name='previous' WHERE id=?",
    )
      .bind(priorInstallationId)
      .run();

    const zeroReservation = await stageEditorExtensionInspection(
      platform.env.DB,
      platform.env.FILES,
      scope,
      { bytes, source: "vsix", runtimeVersion: PLUGIN_EDITOR_VSCODE_VERSION },
    );
    const reservation = await platform.env.DB.prepare(
      "SELECT reservation_bytes FROM plugin_editor_extension_inspections WHERE id=?",
    )
      .bind(zeroReservation.inspectionId)
      .first<{ reservation_bytes: number }>();
    expect(reservation?.reservation_bytes).toBe(0);
    const stagedKey = `plugin-editor/${scope.tenantId}/${scope.principalId}/inspections/${zeroReservation.inspectionId}.vsix`;

    let packageKey = "";
    let raced = false;
    const failingCleanupFiles = hookedFiles({
      get: async (key) => {
        if (key !== stagedKey || raced) return;
        raced = true;
        await uninstallOwnedEditorExtension(
          platform.env.DB,
          platform.env.FILES,
          {
            ...scope,
            installationId: priorInstallationId,
          },
        );
        await platform.env.DB.prepare(
          `INSERT INTO plugin_editor_extension_artifacts(tenant_id,principal_id,sha256,object_key,compressed_bytes,expanded_bytes,created_at,reference_count)
           VALUES(?,?,?,?,?,?,?,0)`,
        )
          .bind(
            scope.tenantId,
            "quota-filler",
            "e".repeat(64),
            "quota-filler/object",
            EDITOR_EXTENSION_TENANT_QUOTA_BYTES,
            1,
            new Date().toISOString(),
          )
          .run();
      },
      delete: async (key) => {
        if (key === packageKey) throw new Error("R2 cleanup unavailable");
      },
      put: async (key) => {
        if (key.includes("/packages/")) packageKey = key;
      },
    });

    await expect(
      installStagedEditorExtension(
        platform.env.DB,
        failingCleanupFiles,
        scope,
        zeroReservation.inspectionId,
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(raced).toBe(true);
    expect(
      await platform.env.DB.prepare(
        "SELECT 1 FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=? AND sha256=?",
      )
        .bind(scope.tenantId, scope.principalId, sha256)
        .first(),
    ).toBeNull();
    expect(
      await platform.env.DB.prepare(
        "SELECT 1 FROM plugin_editor_extension_artifacts WHERE tenant_id=? AND principal_id=? AND sha256=?",
      )
        .bind(scope.tenantId, scope.principalId, sha256)
        .first(),
    ).toBeNull();
    expect(
      await platform.env.DB.prepare(
        "SELECT object_key FROM plugin_editor_extension_cleanup WHERE object_key=? AND tenant_id=? AND principal_id=?",
      )
        .bind(packageKey, scope.tenantId, scope.principalId)
        .first(),
    ).not.toBeNull();
  });

  it("requires the exact inspection to remain unexpired through the installation batch", async () => {
    const scope = { tenantId: "artifact-expiry-race", principalId: "owner" };
    const bytes = vsix();
    const inspection = await stageEditorExtensionInspection(
      platform.env.DB,
      platform.env.FILES,
      scope,
      { bytes, source: "vsix", runtimeVersion: PLUGIN_EDITOR_VSCODE_VERSION },
    );
    let packageKey = "";
    const expiredFiles = hookedFiles({
      put: async (key) => {
        if (!key.includes("/packages/")) return;
        packageKey = key;
        // The package put occurs after the inspection/artifact pre-reads and
        // before the atomic metadata batch.
        await platform.env.DB.prepare(
          "UPDATE plugin_editor_extension_inspections SET expires_at=? WHERE id=? AND tenant_id=? AND principal_id=?",
        )
          .bind(
            new Date(Date.now() - 1_000).toISOString(),
            inspection.inspectionId,
            scope.tenantId,
            scope.principalId,
          )
          .run();
      },
    });

    await expect(
      installStagedEditorExtension(
        platform.env.DB,
        expiredFiles,
        scope,
        inspection.inspectionId,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await platform.env.DB.prepare(
        "SELECT 1 FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=?",
      )
        .bind(scope.tenantId, scope.principalId)
        .first(),
    ).toBeNull();
    expect(
      await platform.env.DB.prepare(
        "SELECT 1 FROM plugin_editor_extension_artifacts WHERE tenant_id=? AND principal_id=?",
      )
        .bind(scope.tenantId, scope.principalId)
        .first(),
    ).toBeNull();
    expect(await platform.env.FILES.get(packageKey)).toBeNull();
  });
});
