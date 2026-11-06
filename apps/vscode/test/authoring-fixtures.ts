import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildPluginIdeBundles } from "../../admin/build/plugin-ide-runtime";
import { checkoutProject } from "../src/checkout";
import { ConnectionManager } from "../src/connection";
import { parsePluginStoreZip } from "../../../packages/studio-server/src/plugin-store";
import { pluginSourceDigest } from "../../../packages/studio-server/src/plugin-development-snapshot";
import type {
  PluginCheckout,
  PluginPublicationReceipt,
  PluginPublicationRequest,
} from "@savia/studio-shared/plugin-development";
export const rootUri = (path: string) => ({ scheme: "file", fsPath: path });
export const initial: PluginCheckout = {
  pluginId: "custom.example",
  sourceVersion: "1.0.0",
  sourceSha256: "a".repeat(64),
  head: { version: "1.0.0", sha256: "b".repeat(64) },
  sharedHead: null,
  authoringKind: "authored",
  entryPath: "entry.tsx",
  files: {
    "entry.tsx":
      'export function render(el: HTMLElement) { el.textContent="Before"; }',
    "savia-extension.json": JSON.stringify({
      format: "savia.extension",
      formatVersion: 1,
      id: "custom.example",
      version: "1.0.0",
      label: "Example",
      description: "",
      requires: [],
      apiVersion: 1,
    }),
    "store.json": JSON.stringify({ format: "savia.store", formatVersion: 1 }),
    "preview.json": JSON.stringify({ collections: {}, settings: {} }),
  },
};
let bundled: ReturnType<typeof buildPluginIdeBundles> | undefined;
export const testBundles = () => (bundled ??= buildPluginIdeBundles());
export async function authoringFixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "savia-commands-"));
  const secrets = new Map<string, string>();
  const snapshots = new Map([["1.0.0", structuredClone(initial)]]);
  const state = {
    head: structuredClone(initial.head),
    posts: [] as { metadata: PluginPublicationRequest; bytes: Uint8Array }[],
    reject: 0,
    lost: false,
    sharedPending: false,
    permissionLostAfterCommit: false,
    onPublish: undefined as
      | undefined
      | ((
          metadata: PluginPublicationRequest,
          bytes: Uint8Array,
        ) => Promise<void>),
  };
  const manager = new ConnectionManager(
    {
      async get(k) {
        return secrets.get(k);
      },
      async store(k, v) {
        secrets.set(k, v);
      },
      async delete(k) {
        secrets.delete(k);
      },
    },
    async (url, init) => {
      const target = new URL(String(url));
      const path = target.pathname;
      if (path.endsWith("/capabilities"))
        return Response.json({
          schemaVersion: 1,
          compilerVersion: 1,
          tenantId: 12,
          principalId: "author",
          workspaceLabel: "Workspace",
          read: true,
          destinations: ["tenant", "shared"],
        });
      if (path.endsWith("/catalog"))
        return Response.json([
          {
            pluginId: initial.pluginId,
            label: "Example",
            head: state.head,
            installedVersion: null,
            versions: [...snapshots.values()].map((source) => ({
              version: source.sourceVersion,
              sha256: source.head.sha256,
              createdAt: "2026-10-12",
              authored: true,
            })),
          },
        ]);
      if (path.includes("/checkout")) {
        const snapshot = snapshots.get(target.searchParams.get("version")!);
        return snapshot
          ? Response.json({ ...snapshot, head: state.head })
          : new Response(null, { status: 404 });
      }
      if (path.endsWith("/publish")) {
        const form = init!.body as FormData;
        const metadata = JSON.parse(
          String(form.get("metadata")),
        ) as PluginPublicationRequest;
        const bytes = new Uint8Array(
          await (form.get("file") as File).arrayBuffer(),
        );
        state.posts.push({ metadata, bytes });
        await state.onPublish?.(metadata, bytes);
        if (state.reject)
          return Response.json({ error: "Rejected" }, { status: state.reject });
        const parsed = await parsePluginStoreZip(bytes);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        state.head = { version: metadata.version, sha256 };
        snapshots.set(metadata.version, {
          ...initial,
          sourceVersion: metadata.version,
          sourceSha256: await pluginSourceDigest(parsed.sourceFiles!),
          head: state.head,
          files: parsed.sourceFiles!,
        });
        if (state.permissionLostAfterCommit)
          return new Response(null, { status: 403 });
        if (state.lost) {
          state.lost = false;
          throw new Error("Lost response");
        }
        const receipt: PluginPublicationReceipt = {
          state: state.sharedPending ? "shared-pending" : "published",
          destination: metadata.destination,
          local: {
            pluginId: metadata.pluginId,
            version: metadata.version,
            sha256,
          },
          head: state.head,
          sharedHead: null,
          issues: state.sharedPending
            ? [{ code: "REGISTRY_UNAVAILABLE", message: "Retry retained ZIP." }]
            : [],
          ...(metadata.destination === "shared" && !state.sharedPending
            ? {
                shared: {
                  pluginId: metadata.pluginId,
                  version: metadata.version,
                  sha256,
                },
              }
            : {}),
        };
        return Response.json(receipt);
      }
      return new Response(null, { status: 404 });
    },
  );
  const connection = await manager.connect(
    "https://savia.test",
    12,
    "fixture-key",
  );
  await checkoutProject(rootUri(root), initial, connection.profile);
  return {
    root,
    uri: rootUri(root),
    manager,
    connection,
    state,
    secrets,
    snapshots,
    async dispose() {
      manager.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
