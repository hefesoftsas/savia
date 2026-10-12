import {
  pluginCheckoutSchema,
  pluginVersionSchema,
  type PluginCheckout,
  type PluginHead,
} from "@savia/studio-shared/plugin-development";
import {
  pluginStoreSourceFilesSchema,
  parsePluginOriginalSourceFiles,
  type PluginProjectFiles,
} from "@savia/studio-shared/plugin-projects";
import {
  pluginStoreManifestSchema,
  validatePluginEntrySource,
} from "@savia/studio-shared/plugin-store";
import {
  canonicalJson,
  compareSolutionVersions,
} from "@savia/studio-shared/solution-package";
import { decodePluginFilesJson } from "./plugin-file-storage";
import type { PluginStoreOptions } from "./plugin-store";
import { fail } from "./context";

export type PluginDevelopmentScope = {
  tenantId: string;
  principalId: string;
  canManageExtension: PluginStoreOptions["canManageExtension"];
};
export async function assertPluginDevelopmentScope(
  scope: PluginDevelopmentScope,
  pluginId: string,
) {
  if (!scope.tenantId || !scope.principalId)
    fail("Authentication is required.", 401);
  let allowed = false;
  try {
    allowed = !!(await scope.canManageExtension?.({
      tenantId: scope.tenantId,
      principalId: scope.principalId,
      extensionId: pluginId,
    }));
  } catch {
    /* fail closed */
  }
  if (!allowed)
    fail("Current plugin administration permission is required.", 403);
}
export type PublicationSnapshot = {
  head: PluginHead | null;
  artifacts: { version: string; sha256: string }[];
  sources: { version: string; files: string }[];
  selectedArtifact: {
    version: string;
    manifest: string;
    entry_js: string;
    store_json: string | null;
  } | null;
};
/** The batch reads share a transaction; carry raw source strings into write guards. */
export async function readPublicationSnapshot(
  db: D1Database,
  tenantId: string,
  pluginId: string,
  selectedVersion?: string,
): Promise<PublicationSnapshot> {
  const [artifacts, sources, selected] = await db.batch([
    db
      .prepare(
        "SELECT version,sha256 FROM plugin_store_artifacts WHERE tenant_id=? AND id=? ORDER BY version LIMIT 11",
      )
      .bind(tenantId, pluginId),
    db
      .prepare(
        "SELECT version,files FROM plugin_store_sources WHERE tenant_id=? AND id=? ORDER BY version LIMIT 11",
      )
      .bind(tenantId, pluginId),
    db
      .prepare(
        "SELECT version,manifest,entry_js,store_json FROM plugin_store_artifacts WHERE tenant_id=? AND id=? AND version=?",
      )
      .bind(tenantId, pluginId, selectedVersion ?? ""),
  ]);
  if (artifacts.results.length > 10 || sources.results.length > 10)
    fail("Plugin version snapshot exceeds its limit.", 413);
  const rows = artifacts.results as PublicationSnapshot["artifacts"];
  for (const row of rows) {
    pluginVersionSchema.parse(row.version);
    if (!/^[a-f0-9]{64}$/.test(row.sha256))
      fail("Plugin artifact identity is unavailable.", 404);
  }
  rows.sort((a, b) => compareSolutionVersions(b.version, a.version));
  return {
    head: rows[0] ?? null,
    artifacts: rows,
    sources: sources.results as PublicationSnapshot["sources"],
    selectedArtifact:
      (selected.results[0] as PublicationSnapshot["selectedArtifact"]) ?? null,
  };
}
/** Canonical archive maps keep the digest stable when map insertion order changes. */
export async function pluginSourceDigest(
  files: PluginProjectFiles,
): Promise<string> {
  const normalized = {
    ...files,
    ...(files["original-source.json"]
      ? {
          "original-source.json": canonicalJson(
            parsePluginOriginalSourceFiles(files["original-source.json"]),
          ),
        }
      : {}),
  };
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalJson(normalized)),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function authoredPluginEntryPath(files: PluginProjectFiles): string {
  if (!files["original-source.json"]) return "entry.tsx";
  const archive = parsePluginOriginalSourceFiles(files["original-source.json"]);
  const entries = Object.keys(archive).filter((path) =>
    /(?:^|\/)entry\.(tsx|jsx|js)$/.test(path),
  );
  if (entries.length !== 1)
    fail("Plugin source must include one unambiguous entry module.", 404);
  for (const [path, text] of Object.entries(archive)) {
    if (
      /\.(png|webp)$/.test(path) &&
      !/^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(text)
    )
      fail("Plugin source asset is unavailable.", 404);
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    for (const match of text.matchAll(
      /(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+\.(?:png|webp|svg))["']/g,
    )) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const parts = path.split("/").slice(0, -1);
      for (const part of specifier.split("/")) {
        if (part === "..") parts.pop();
        else if (part !== ".") parts.push(part);
      }
      if (!Object.hasOwn(archive, parts.join("/")))
        fail("Plugin source asset is unavailable.", 404);
    }
  }
  return entries[0];
}
/** Reuse this resolver in the browser source endpoint without changing its response. */
export async function resolvePublishedPluginFiles(
  artifact: { manifest: string; entry_js: string; store_json?: string | null },
  source?: string,
): Promise<{
  files: PluginProjectFiles;
  authoringKind: "authored" | "compiled-only";
}> {
  if (source !== undefined) {
    try {
      return {
        files: pluginStoreSourceFilesSchema.parse(
          JSON.parse(await decodePluginFilesJson(source)),
        ),
        authoringKind: "authored",
      };
    } catch {
      return fail("Plugin source is unavailable.", 404);
    }
  }
  try {
    validatePluginEntrySource(artifact.entry_js);
    const manifest = JSON.parse(artifact.manifest);
    pluginStoreManifestSchema.parse(manifest);
    const store = artifact.store_json
      ? JSON.parse(artifact.store_json)
      : {
          format: "savia.store",
          formatVersion: 1,
          actions: [],
          connectors: [],
          collections: [],
          bundles: [],
          widgets: [],
          screens: [],
        };
    return {
      authoringKind: "compiled-only",
      files: pluginStoreSourceFilesSchema.parse({
        "entry.tsx": artifact.entry_js,
        "savia-extension.json": JSON.stringify(manifest, null, 2) + "\n",
        "store.json": JSON.stringify(store, null, 2) + "\n",
        "preview.json": '{\n  "collections": {},\n  "settings": {}\n}\n',
      }),
    };
  } catch {
    return fail("Plugin source is unavailable.", 404);
  }
}
export async function loadPluginCheckout(
  db: D1Database,
  scope: PluginDevelopmentScope,
  pluginId: string,
  version: string,
  registry?: PluginStoreOptions["pluginRegistry"],
): Promise<PluginCheckout> {
  await assertPluginDevelopmentScope(scope, pluginId);
  pluginStoreManifestSchema.shape.id.parse(pluginId);
  if (!pluginVersionSchema.safeParse(version).success)
    fail("An explicit plugin version is required.", 400);
  const snapshot = await readPublicationSnapshot(
    db,
    scope.tenantId,
    pluginId,
    version,
  );
  if (!snapshot.selectedArtifact || !snapshot.head)
    fail("Plugin source is not available for this version.", 404);
  const source = snapshot.sources.find((row) => row.version === version);
  const { files, authoringKind } = await resolvePublishedPluginFiles(
    snapshot.selectedArtifact,
    source?.files,
  );
  const entryPath =
    authoringKind === "authored" ? authoredPluginEntryPath(files) : "entry.tsx";
  const sharedHead = registry
    ? await (
        await import("./plugin-registry")
      ).getPluginRegistryHead(registry, pluginId)
    : null;
  const sourceSha256 = await pluginSourceDigest(files);
  await assertPluginDevelopmentScope(scope, pluginId);
  const current = await readPublicationSnapshot(
    db,
    scope.tenantId,
    pluginId,
    version,
  );
  if (canonicalJson(current) !== canonicalJson(snapshot))
    fail(
      "Plugin source or head changed during checkout. Refresh and retry.",
      409,
    );
  return pluginCheckoutSchema.parse({
    pluginId,
    sourceVersion: version,
    sourceSha256,
    head: snapshot.head,
    sharedHead,
    authoringKind,
    files,
    entryPath,
  });
}
