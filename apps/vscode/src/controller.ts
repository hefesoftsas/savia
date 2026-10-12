import { join } from "node:path";
import type { AuthoringBundles } from "@savia/plugin-authoring";
import {
  parsePluginOriginalSourceFiles,
  type PluginProjectFiles,
} from "@savia/studio-shared/plugin-projects";
import {
  compareSolutionVersions,
  canonicalJson,
} from "@savia/studio-shared/solution-package";
import {
  localPluginDescriptorSchema,
  pluginVersionSchema,
  type PluginCatalogEntry,
  type PluginCheckout,
  type PluginPublicationReceipt,
} from "@savia/studio-shared/plugin-development";
import { ConnectionManager, type ActiveConnection } from "./connection";
import { PluginTreeProvider, type PluginTreeNode } from "./tree";
import { PublishedSourceProvider } from "./documents";
import { checkoutProject, descriptorPath, baselinePath } from "./checkout";
import {
  readProjectDescriptor,
  readLocalProject,
  selectProjectRoot,
  baselineSchema,
} from "./project";
import {
  resolveProjectRoot,
  readProjectFile,
  type ProjectRoot,
} from "./filesystem";
import {
  buildLocalProject,
  requireTrusted,
  type BuildDiagnostic,
} from "./build";
import {
  preparePublication,
  publishPrepared,
  recoverPublication,
  listPublicationAttempts,
  type PublicationAttempt,
} from "./publication";
import { writeMetadata } from "./metadata";
import { nativeDeclarationFiles } from "./declarations";
export type FileChange = {
  path: string;
  kind: "added" | "modified" | "deleted";
};
export type PublicationSummary = {
  pluginId: string;
  version: string;
  destination: "tenant" | "shared";
  workspaceLabel: string;
  sourceVersion: string;
  sha256: string;
  changes: FileChange[];
  recovery?: boolean;
  rebase?: boolean;
};
export interface AuthoringUi {
  isTrusted(): boolean;
  projectRoots(): readonly ProjectRoot[];
  saveAll(): PromiseLike<boolean>;
  pickRoot(roots: readonly ProjectRoot[]): PromiseLike<ProjectRoot | undefined>;
  chooseDestination(
    destinations: readonly ("tenant" | "shared")[],
    workspaceLabel: string,
  ): PromiseLike<"tenant" | "shared" | undefined>;
  chooseVersion(
    suggested: string,
    minimum: string,
  ): PromiseLike<string | undefined>;
  confirmPublication(summary: PublicationSummary): PromiseLike<boolean>;
  diagnostics(items: BuildDiagnostic[], root?: ProjectRoot): void;
  pickPlugin(catalog: PluginCatalogEntry[]): PromiseLike<string | undefined>;
  pickFile(
    files: { path: string; uri: string }[],
  ): PromiseLike<string | undefined>;
  chooseFolder(): PromiseLike<ProjectRoot | undefined>;
  openFile(root: ProjectRoot, path: string): PromiseLike<void>;
  openVirtual(uri: string): PromiseLike<void>;
  showDiff(
    uri: string,
    localPath: string,
    title: string,
    root?: ProjectRoot,
  ): PromiseLike<void>;
  chooseAttempt(
    attempts: PublicationAttempt[],
  ): PromiseLike<string | undefined>;
  notify(code: string, values?: Record<string, string>): PromiseLike<void>;
}
function sourceMap(files: PluginProjectFiles) {
  const result: Record<string, string> = files["original-source.json"]
    ? parsePluginOriginalSourceFiles(files["original-source.json"])
    : { "entry.tsx": files["entry.tsx"] };
  for (const key of [
    "savia-extension.json",
    "store.json",
    "preview.json",
  ] as const)
    result[key] = files[key];
  return result;
}
export function changedFiles(
  before: PluginProjectFiles,
  after: PluginProjectFiles,
): FileChange[] {
  const base = sourceMap(before),
    next = sourceMap(after);
  return [...new Set([...Object.keys(base), ...Object.keys(next)])]
    .sort()
    .flatMap((path) =>
      base[path] === next[path]
        ? []
        : [
            {
              path,
              kind: !(path in base)
                ? ("added" as const)
                : !(path in next)
                  ? ("deleted" as const)
                  : ("modified" as const),
            },
          ],
    );
}
export function nextPluginVersion(version: string) {
  pluginVersionSchema.parse(version);
  const parts = version.split(".");
  return pluginVersionSchema.parse(
    `${parts[0]}.${parts[1]}.${BigInt(parts[2]) + 1n}`,
  );
}
export class AuthoringController {
  private catalog: PluginCatalogEntry[] = [];
  private operations = new Set<string>();
  constructor(
    readonly connections: ConnectionManager,
    readonly tree: PluginTreeProvider,
    readonly documents: PublishedSourceProvider,
    private bundles: AuthoringBundles,
    readonly ui: AuthoringUi,
    private declarations = nativeDeclarationFiles,
  ) {}
  private connected(): ActiveConnection {
    const connection = this.connections.current;
    if (!connection) throw new Error("Connect to Savia first.");
    return connection;
  }
  private current(connection: ActiveConnection, root?: ProjectRoot) {
    if (
      this.connections.current !== connection ||
      (root &&
        !this.ui
          .projectRoots()
          .some(
            (item) =>
              item.scheme === root.scheme && item.fsPath === root.fsPath,
          ))
    )
      throw new Error(
        "The connection or selected workspace changed. Retry in the selected connection.",
      );
  }
  private async chooseRoot(connection: ActiveConnection) {
    const root = await selectProjectRoot(this.ui.projectRoots(), (roots) =>
      this.ui.pickRoot(roots),
    );
    this.current(connection);
    return root;
  }
  private async exclusive<T>(
    root: ProjectRoot,
    action: () => Promise<T>,
  ): Promise<T> {
    const key = root.scheme + ":" + root.fsPath;
    if (this.operations.has(key))
      throw new Error(
        "A publication operation is already running for this project.",
      );
    this.operations.add(key);
    try {
      return await action();
    } finally {
      this.operations.delete(key);
    }
  }
  async refresh() {
    const connection = this.connected();
    const capabilities = await connection.client.capabilities();
    this.current(connection);
    connection.capabilities = capabilities;
    const catalog = capabilities.read ? await connection.client.catalog() : [];
    this.current(connection);
    this.catalog = catalog;
    this.tree.setCatalog(catalog);
    if (!capabilities.read) await this.ui.notify("sourceScopeRequired");
  }
  async disconnect() {
    await this.connections.disconnect();
    this.catalog = [];
    this.tree.setCatalog([]);
    this.documents.clear();
    this.ui.diagnostics([]);
  }
  async inspect(node?: PluginTreeNode) {
    const connection = this.connected();
    await this.refresh();
    this.current(connection);
    const pluginId = node?.pluginId ?? (await this.ui.pickPlugin(this.catalog));
    if (!pluginId) return;
    const plugin = this.catalog.find((item) => item.pluginId === pluginId);
    if (!plugin) throw new Error("The selected plugin is unavailable.");
    const checkout = await connection.client.checkout(
      pluginId,
      node?.version ?? plugin.head.version,
    );
    this.current(connection);
    const sources = this.documents.add(
      connection.profile.id,
      pluginId,
      checkout.sourceVersion,
      sourceMap(checkout.files),
    );
    const path = await this.ui.pickFile(sources);
    this.current(connection);
    const source = sources.find((source) => source.path === path);
    if (source) await this.ui.openVirtual(source.uri);
    if (checkout.authoringKind === "compiled-only")
      await this.ui.notify("compiledOnly");
  }
  async checkout(node?: PluginTreeNode, historical = false) {
    const connection = this.connected();
    await this.refresh();
    this.current(connection);
    const pluginId = node?.pluginId ?? (await this.ui.pickPlugin(this.catalog));
    if (!pluginId) return;
    const plugin = this.catalog.find((item) => item.pluginId === pluginId);
    if (!plugin) throw new Error("The selected plugin is unavailable.");
    const version = historical ? node?.version : plugin.head.version;
    if (!version)
      throw new Error("Select the historical version to use as a base.");
    const checkout = await connection.client.checkout(pluginId, version);
    this.current(connection);
    if (!historical && checkout.sourceVersion !== checkout.head.version)
      throw new Error(
        "The latest plugin head changed. Refresh and select it again.",
      );
    if (checkout.authoringKind !== "authored")
      throw new Error(
        "This compiled-only plugin has no editable authored source.",
      );
    const root = await this.ui.chooseFolder();
    this.current(connection);
    if (!root) return;
    await checkoutProject(
      root,
      checkout,
      connection.profile,
      this.declarations,
    );
    this.current(connection);
    await this.ui.openFile(root, checkout.entryPath);
    await this.ui.notify("checkoutReady", { pluginId, version });
  }
  async build() {
    const connection = this.connected();
    requireTrusted(this.ui.isTrusted());
    const root = await this.chooseRoot(connection);
    if (!root) return;
    const build = await buildLocalProject(
      root,
      connection.profile,
      this.bundles,
      {
        isTrusted: () => this.ui.isTrusted(),
        saveAll: () => this.ui.saveAll(),
        diagnostics: (items) => this.ui.diagnostics(items, root),
      },
    );
    this.current(connection, root);
    if (build)
      await this.ui.notify("buildReady", { pluginId: build.manifest.id });
    return build;
  }
  async publish() {
    const connection = this.connected();
    requireTrusted(this.ui.isTrusted());
    const root = await this.chooseRoot(connection);
    if (!root) return;
    return this.exclusive(root, async () => {
      const descriptor = await readProjectDescriptor(root, connection.profile);
      this.current(connection, root);
      const capabilities = await connection.client.capabilities();
      this.current(connection, root);
      if (!capabilities.read || !capabilities.destinations.length)
        throw new Error(
          "Connect a key with plugins:read and plugins:publish and current plugin administration permission.",
        );
      const remote = await connection.client.checkout(
        descriptor.pluginId,
        descriptor.sourceVersion,
      );
      this.current(connection, root);
      if (canonicalJson(remote.head) !== canonicalJson(descriptor.expectedHead))
        throw new Error(
          "The plugin head changed. Compare and explicitly update the publication base.",
        );
      if (remote.sourceSha256 !== descriptor.sourceSha256)
        throw new Error(
          "The selected source changed or was removed. Choose a publication base again.",
        );
      const destination = await this.ui.chooseDestination(
        capabilities.destinations,
        capabilities.workspaceLabel,
      );
      this.current(connection, root);
      if (!destination) return;
      if (!capabilities.destinations.includes(destination))
        throw new Error(
          "This destination is not authorized by the connected key.",
        );
      const minimum =
        destination === "shared" &&
        remote.sharedHead &&
        compareSolutionVersions(
          remote.sharedHead.version,
          remote.head.version,
        ) > 0
          ? remote.sharedHead.version
          : remote.head.version;
      const version = await this.ui.chooseVersion(
        nextPluginVersion(minimum),
        minimum,
      );
      this.current(connection, root);
      if (!version) return;
      pluginVersionSchema.parse(version);
      if (compareSolutionVersions(version, minimum) <= 0)
        throw new Error(
          "The publication version must be greater than the current head.",
        );
      const publication = await preparePublication(
        root,
        connection.profile,
        this.bundles,
        { destination, version },
        {
          isTrusted: () => this.ui.isTrusted(),
          saveAll: () => this.ui.saveAll(),
          diagnostics: (items) => this.ui.diagnostics(items, root),
        },
      );
      this.current(connection, root);
      if (!publication) return;
      if (canonicalJson(publication.descriptor) !== canonicalJson(descriptor))
        throw new Error(
          "The local publication base changed. Compare and retry.",
        );
      const confirmation: PublicationSummary = {
        pluginId: descriptor.pluginId,
        version,
        destination,
        workspaceLabel: capabilities.workspaceLabel,
        sourceVersion: descriptor.sourceVersion,
        sha256: publication.sha256,
        changes: changedFiles(remote.files, publication.files),
      };
      if (!(await this.ui.confirmPublication(confirmation))) return;
      this.current(connection, root);
      const result = await publishPrepared(publication, connection.client, {
        isTrusted: () => this.ui.isTrusted(),
        isCurrent: () =>
          this.connections.current === connection &&
          this.ui
            .projectRoots()
            .some(
              (item) =>
                item.scheme === root.scheme && item.fsPath === root.fsPath,
            ),
      });
      this.current(connection, root);
      if (!result.receiptSaved) await this.ui.notify("receiptNotRecorded");
      await this.confirmed(root, connection, result.receipt, descriptor);
      return result;
    });
  }
  private async confirmed(
    root: ProjectRoot,
    connection: ActiveConnection,
    receipt: PluginPublicationReceipt,
    expectedDescriptor?: Awaited<ReturnType<typeof readProjectDescriptor>>,
  ) {
    this.current(connection, root);
    try {
      const published = await connection.client.checkout(
        receipt.local.pluginId,
        receipt.local.version,
      );
      this.current(connection, root);
      const descriptor = await readProjectDescriptor(root, connection.profile);
      if (
        expectedDescriptor &&
        canonicalJson(descriptor) !== canonicalJson(expectedDescriptor)
      )
        throw new Error("Local base changed.");
      const { path } = await resolveProjectRoot(root);
      const baseline = baselineSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await readProjectFile(
              path,
              baselinePath,
              5 * 1024 * 1024 + 64 * 1024,
            ),
          ),
        ),
      );
      await writeMetadata(
        root,
        baselinePath,
        JSON.stringify({ ...baseline, files: published.files }, null, 2) + "\n",
      );
      await writeMetadata(
        root,
        descriptorPath,
        JSON.stringify(
          localPluginDescriptorSchema.parse({
            ...descriptor,
            sourceVersion: published.sourceVersion,
            sourceSha256: published.sourceSha256,
            expectedHead: {
              version: receipt.local.version,
              sha256: receipt.local.sha256,
            },
          }),
          null,
          2,
        ) + "\n",
      );
    } catch {
      this.current(connection, root);
      await this.ui.notify("baselineNotUpdated");
    }
    this.current(connection, root);
    const latest =
      receipt.head.version === receipt.local.version ? "yes" : "no";
    await this.ui.notify(
      receipt.state === "published" ? "published" : receipt.state,
      {
        pluginId: receipt.local.pluginId,
        version: receipt.local.version,
        destination: receipt.destination,
        latest,
        sha256: receipt.local.sha256,
        sharedLatest: receipt.sharedHead
          ? receipt.sharedHead.version === receipt.shared?.version
            ? "yes"
            : "no"
          : "unknown",
      },
    );
    await this.refresh();
  }
  async recover(sharedOnly = false) {
    const connection = this.connected();
    requireTrusted(this.ui.isTrusted());
    const root = await this.chooseRoot(connection);
    if (!root) return;
    return this.exclusive(root, async () => {
      const descriptor = await readProjectDescriptor(root, connection.profile);
      const attempts = (
        await listPublicationAttempts(root, connection.profile)
      ).filter(
        (item) =>
          (!sharedOnly || item.input.destination === "shared") &&
          (item.state === "uncertain" ||
            item.state === "prepared" ||
            item.receipt?.state === "shared-pending" ||
            item.receipt?.state === "shared-conflict"),
      );
      this.current(connection, root);
      const sha = await this.ui.chooseAttempt(attempts);
      this.current(connection, root);
      if (!sha) return;
      const attempt = attempts.find((item) => item.sha256 === sha);
      if (!attempt)
        throw new Error("The selected retained publication is unavailable.");
      if (
        !(await this.ui.confirmPublication({
          pluginId: attempt.input.pluginId,
          version: attempt.input.version,
          destination: attempt.input.destination,
          workspaceLabel: connection.capabilities.workspaceLabel,
          sourceVersion: attempt.input.sourceVersion,
          sha256: sha,
          changes: [],
          recovery: true,
        }))
      )
        return;
      this.current(connection, root);
      const result = await recoverPublication(
        root,
        connection.profile,
        sha,
        connection.client,
        {
          isTrusted: () => this.ui.isTrusted(),
          isCurrent: () => this.connections.current === connection,
        },
      );
      this.current(connection, root);
      if (!result.receiptSaved) await this.ui.notify("receiptNotRecorded");
      await this.confirmed(root, connection, result.receipt, descriptor);
      return result;
    });
  }
  async compare(node?: PluginTreeNode) {
    const connection = this.connected();
    const root = await this.chooseRoot(connection);
    if (!root) return;
    const project = await readLocalProject(root, connection.profile);
    this.current(connection, root);
    if (node && node.pluginId !== project.descriptor.pluginId)
      throw new Error("Select the workspace root that belongs to this plugin.");
    await this.refresh();
    this.current(connection, root);
    const plugin = this.catalog.find(
      (item) => item.pluginId === project.descriptor.pluginId,
    );
    if (!plugin)
      throw new Error("The plugin is unavailable. Keep your local files.");
    const remote = await connection.client.checkout(
      project.descriptor.pluginId,
      node?.version ?? plugin.head.version,
    );
    this.current(connection, root);
    const sources = this.documents.add(
      connection.profile.id,
      remote.pluginId,
      remote.sourceVersion,
      sourceMap(remote.files),
    );
    const path = await this.ui.pickFile(sources);
    this.current(connection, root);
    const source = sources.find((item) => item.path === path);
    if (source)
      await this.ui.showDiff(
        source.uri,
        join(root.fsPath, ...source.path.split("/")),
        `${remote.pluginId}@${remote.sourceVersion} ↔ ${source.path}`,
        root,
      );
  }
  async rebase() {
    const connection = this.connected();
    requireTrusted(this.ui.isTrusted());
    const root = await this.chooseRoot(connection);
    if (!root) return;
    return this.exclusive(root, async () => {
      const descriptor = await readProjectDescriptor(root, connection.profile);
      await this.refresh();
      this.current(connection, root);
      const plugin = this.catalog.find(
        (item) => item.pluginId === descriptor.pluginId,
      );
      if (!plugin)
        throw new Error("The plugin is unavailable. Keep your local files.");
      const latest = await connection.client.checkout(
        descriptor.pluginId,
        plugin.head.version,
      );
      this.current(connection, root);
      if (latest.authoringKind !== "authored")
        throw new Error("The latest plugin has no authored publication base.");
      await this.ui.notify("reviewBeforeRebase");
      if (
        !(await this.ui.confirmPublication({
          pluginId: descriptor.pluginId,
          version: latest.sourceVersion,
          destination: "tenant",
          workspaceLabel: connection.capabilities.workspaceLabel,
          sourceVersion: descriptor.sourceVersion,
          sha256: latest.sourceSha256,
          changes: [],
          rebase: true,
        }))
      )
        return;
      this.current(connection, root);
      requireTrusted(this.ui.isTrusted());
      await writeMetadata(
        root,
        descriptorPath,
        JSON.stringify(
          localPluginDescriptorSchema.parse({
            ...descriptor,
            sourceVersion: latest.sourceVersion,
            sourceSha256: latest.sourceSha256,
            expectedHead: latest.head,
          }),
          null,
          2,
        ) + "\n",
      );
      await this.ui.notify("baseUpdated");
    });
  }
}
