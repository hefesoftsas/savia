import * as vscode from "vscode";
import fs from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { pluginDevelopmentOriginSchema } from "@savia/studio-shared/plugin-development";
import type { AuthoringBundles } from "@savia/plugin-authoring";
import { ConnectionManager, credentialKey } from "./connection";
import { PluginDevelopmentError, type ConnectionProfile } from "./client";
import { AuthoringController, type AuthoringUi } from "./controller";
import { PluginTreeProvider, type PluginTreeNode } from "./tree";
import { PublishedSourceProvider } from "./documents";
import {
  createNativeUi,
  chooseConnection,
  type ConnectionSelection,
} from "./native-ui";
import { localeFor, translator } from "./i18n";

const t = translator(localeFor(vscode.env.language));
const profileSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    origin: pluginDevelopmentOriginSchema,
    tenantId: z.number().int().positive(),
    principalId: z.string().min(1).max(200),
  })
  .strict();
export async function loadAuthoringBundles(
  extensionPath: string,
): Promise<AuthoringBundles> {
  const source = await fs.readFile(
    join(extensionPath, "assets/bundles.json"),
    "utf8",
  );
  const bundleSchema = z
    .object({
      runtimeBundle: z.string().min(1),
      vendorBundles: z.record(z.string(), z.string().min(1)),
    })
    .strict();
  const bundles = bundleSchema.parse(JSON.parse(source));
  if (!bundles.vendorBundles.zod || !bundles.vendorBundles["pdf-lib"])
    throw new Error(
      "The extension's pinned compiler assets are unavailable. Reinstall the VSIX.",
    );
  return bundles;
}
export type RuntimeOptions = {
  ui?: AuthoringUi;
  bundles?: AuthoringBundles;
  declarations?: Record<string, string>;
  selectConnection?: (
    profiles: ConnectionProfile[],
  ) => Promise<ConnectionSelection | undefined>;
};
/** One lifecycle factory keeps native host services separate from operator dialogs. */
export function createAuthoringRuntime(
  context: vscode.ExtensionContext,
  options: RuntimeOptions = {},
) {
  const disposables: vscode.Disposable[] = [];
  const connections = new ConnectionManager(context.secrets);
  const tree = new PluginTreeProvider();
  const documents = new PublishedSourceProvider();
  const diagnostics = vscode.languages.createDiagnosticCollection("savia");
  disposables.push(diagnostics);
  const ui = options.ui ?? createNativeUi(diagnostics);
  let controller: AuthoringController | undefined;
  let connectionGeneration = 0;
  let disposed = false;
  const ready = (async () => {
    controller = new AuthoringController(
      connections,
      tree,
      documents,
      options.bundles ?? (await loadAuthoringBundles(context.extensionPath)),
      ui,
      options.declarations ??
        z
          .record(z.string(), z.string())
          .parse(
            JSON.parse(
              await fs.readFile(
                join(context.extensionPath, "assets/declarations.json"),
                "utf8",
              ),
            ),
          ),
    );
    return controller;
  })();
  void ready.catch(() => undefined);
  const sourceRegistration =
    vscode.workspace.registerTextDocumentContentProvider(
      "savia-source",
      documents,
    );
  disposables.push(sourceRegistration);
  const emitter = new vscode.EventEmitter<PluginTreeNode | undefined>();
  disposables.push(
    emitter,
    tree.onDidChangeTreeData(() => emitter.fire(undefined)),
  );
  const provider: vscode.TreeDataProvider<PluginTreeNode> = {
    onDidChangeTreeData: emitter.event,
    getChildren: (node) => tree.getChildren(node),
    getTreeItem(node) {
      const item = new vscode.TreeItem(
        node.kind === "plugin" ? node.label : `v${node.version}`,
        node.kind === "plugin"
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      item.id = `${node.pluginId}:${node.version ?? "root"}`;
      item.tooltip =
        node.kind === "plugin"
          ? node.pluginId
          : `${node.pluginId}@${node.version}`;
      item.description =
        node.kind === "version"
          ? [
              node.latest ? t("latest") : "",
              node.installed ? t("installed") : "",
              !node.authored ? t("compiled") : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : node.pluginId;
      item.contextValue =
        node.kind === "plugin"
          ? "savia.plugin"
          : `savia.version.${node.latest ? "latest" : "history"}.${node.authored ? "authored" : "compiled"}`;
      item.iconPath = new vscode.ThemeIcon(
        node.kind === "plugin" ? "package" : "versions",
      );
      if (node.kind === "version")
        item.command = {
          command: "savia.inspectVersion",
          title: t("sourceFile"),
          arguments: [node],
        };
      return item;
    },
  };
  const view = vscode.window.createTreeView("savia.plugins", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  disposables.push(view);
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    20,
  );
  status.text = "$(plug) Savia";
  status.command = "savia.connect";
  status.show();
  disposables.push(status);
  const openSavia = async () => {
    const current = connections.current;
    if (!current) throw new Error("Connect to Savia first.");
    const url = new URL("/", current.profile.origin);
    url.hash = `/plugin-studio?tenantId=${current.profile.tenantId}`;
    await vscode.env.openExternal(vscode.Uri.parse(url.href));
  };
  const run =
    (
      action: (
        controller: AuthoringController,
        ...args: any[]
      ) => Promise<unknown>,
    ) =>
    async (...args: any[]) => {
      try {
        return await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: t("working") },
          async () => action(await ready, ...args),
        );
      } catch (error) {
        if (
          error instanceof PluginDevelopmentError &&
          ["CONNECTION_CHANGED", "CANCELLED"].includes(error.code)
        )
          return undefined;
        const message =
          error instanceof Error ? error.message : "The operation failed.";
        const conflict =
          /head changed|source changed|base changed|rebase/i.test(message);
        const choice = await vscode.window.showErrorMessage(
          t("failed", { message }),
          ...(conflict ? [t("compare"), t("updateBase")] : [t("recover")]),
        );
        if (choice === t("compare"))
          await vscode.commands.executeCommand("savia.comparePublished");
        if (choice === t("updateBase"))
          await vscode.commands.executeCommand("savia.updatePublicationBase");
        if (choice === t("recover"))
          await vscode.commands.executeCommand("savia.recoverPublication");
        return undefined;
      }
    };
  const command = (
    id: string,
    action: (
      controller: AuthoringController,
      ...args: any[]
    ) => Promise<unknown>,
  ) => disposables.push(vscode.commands.registerCommand(id, run(action)));
  command("savia.connect", async (control) => {
    const generation = ++connectionGeneration;
    const current = () => !disposed && generation === connectionGeneration;
    const stored = z
      .array(profileSchema)
      .max(100)
      .safeParse(context.globalState.get("savia.profiles", []));
    const profiles = stored.success ? stored.data : [];
    const selection = await (options.selectConnection ?? chooseConnection)(
      profiles,
    );
    if (!selection || !current()) return;
    let origin: string,
      tenantId: number,
      token: string,
      principal: string | undefined;
    if (selection.kind === "saved") {
      const saved = profileSchema.parse(selection.profile);
      const existing = await context.secrets.get(credentialKey(saved.id));
      if (!current()) return;
      const entered =
        existing ??
        (await vscode.window.showInputBox({
          title: t("key"),
          prompt: t("keyHint"),
          password: true,
          ignoreFocusOut: true,
        }));
      if (entered === undefined || !current()) return;
      origin = saved.origin;
      tenantId = saved.tenantId;
      token = entered;
      principal = saved.principalId;
    } else {
      origin = selection.origin;
      tenantId = selection.tenantId;
      token = selection.token;
    }
    connections.dispose();
    tree.setCatalog([]);
    documents.clear();
    diagnostics.clear();
    await vscode.commands.executeCommand(
      "setContext",
      "savia.connected",
      false,
    );
    if (!current()) return;
    status.text = "$(sync~spin) Savia";
    const connection = await connections.connect(
      origin,
      tenantId,
      token,
      principal,
    );
    if (!current()) return;
    await context.globalState.update(
      "savia.profiles",
      [
        connection.profile,
        ...profiles.filter((profile) => profile.id !== connection.profile.id),
      ].slice(0, 100),
    );
    if (!current()) return;
    await vscode.commands.executeCommand("setContext", "savia.connected", true);
    if (!current()) return;
    status.text = `$(plug) Savia · ${connection.capabilities.workspaceLabel}`;
    status.tooltip = connection.profile.origin;
    await control.refresh();
    if (current())
      await ui.notify("connected", {
        workspace: connection.capabilities.workspaceLabel,
      });
  });
  command("savia.disconnect", async (control) => {
    ++connectionGeneration;
    await control.disconnect();
    await vscode.commands.executeCommand(
      "setContext",
      "savia.connected",
      false,
    );
    status.text = "$(plug) Savia";
    status.tooltip = undefined;
    await ui.notify("disconnected");
  });
  command("savia.refresh", (control) => control.refresh());
  command("savia.checkout", (control, node?: PluginTreeNode) =>
    control.checkout(node),
  );
  command("savia.useVersionAsBase", (control, node?: PluginTreeNode) =>
    control.checkout(node, true),
  );
  command("savia.inspectVersion", (control, node?: PluginTreeNode) =>
    control.inspect(node),
  );
  command("savia.comparePublished", (control, node?: PluginTreeNode) =>
    control.compare(node),
  );
  command("savia.build", (control) => control.build());
  command("savia.publish", (control) => control.publish());
  command("savia.retrySharedPublication", (control) => control.recover(true));
  command("savia.recoverPublication", (control) => control.recover());
  command("savia.updatePublicationBase", (control) => control.rebase());
  command("savia.openInSavia", async () => openSavia());
  return {
    connections,
    tree,
    documents,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      ++connectionGeneration;
      connections.dispose();
      tree.dispose();
      documents.dispose();
      for (const disposable of disposables.reverse()) disposable.dispose();
    },
  };
}
let runtime: ReturnType<typeof createAuthoringRuntime> | undefined;
export function activate(context: vscode.ExtensionContext) {
  runtime = createAuthoringRuntime(context);
  context.subscriptions.push(runtime);
}
export function deactivate() {
  runtime?.dispose();
  runtime = undefined;
}
