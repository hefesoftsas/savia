import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { createAuthoringRuntime } from "../../src/extension";
import { comparisonUri } from "../../src/native-ui";
import type { AuthoringUi } from "../../src/controller";
let active: ReturnType<typeof createAuthoringRuntime> | undefined;
export async function activate(context: vscode.ExtensionContext) {
  const fixture = JSON.parse(
    await fs.readFile(process.env.SAVIA_HOST_FIXTURE!, "utf8"),
  );
  const root = vscode.Uri.file(fixture.root);
  const diagnostics =
    vscode.languages.createDiagnosticCollection("savia-host-proof");
  const notices: string[] = [];
  const ui: AuthoringUi = {
    isTrusted: () => vscode.workspace.isTrusted,
    projectRoots: () => [root],
    saveAll: () => vscode.workspace.saveAll(false),
    pickRoot: async (roots) => roots[0],
    chooseDestination: async () => "tenant",
    chooseVersion: async () => "1.1.0",
    confirmPublication: async () => true,
    diagnostics(items, root) {
      diagnostics.clear();
      for (const item of items)
        diagnostics.set(vscode.Uri.file(join(root!.fsPath, item.path)), [
          new vscode.Diagnostic(
            new vscode.Range(
              item.line,
              item.column,
              item.line,
              item.column + 1,
            ),
            item.message,
            vscode.DiagnosticSeverity.Error,
          ),
        ]);
    },
    pickPlugin: async (catalog) => catalog[0]?.pluginId,
    pickFile: async (files) =>
      files.find((file) => file.path === "entry.tsx")?.path,
    chooseFolder: async () => root,
    async openFile(root, path) {
      await vscode.window.showTextDocument(
        vscode.Uri.file(join(root.fsPath, path)),
        { preview: false },
      );
    },
    async openVirtual(uri) {
      await vscode.window.showTextDocument(vscode.Uri.parse(uri), {
        preview: false,
      });
    },
    async showDiff(uri, path, title) {
      await vscode.commands.executeCommand(
        "vscode.diff",
        vscode.Uri.parse(uri),
        vscode.Uri.file(path),
        title,
      );
    },
    chooseAttempt: async (attempts) => attempts[0]?.sha256,
    notify: async (code) => {
      notices.push(code);
    },
  };
  active = createAuthoringRuntime(context, {
    ui,
    selectConnection: async () => ({
      kind: "new",
      origin: fixture.origin,
      tenantId: 12,
      token: fixture.key,
    }),
  });
  context.subscriptions.push(active, diagnostics);
  return { runtime: active, diagnostics, notices, root, context };
}
export function deactivate() {
  active?.dispose();
}
export async function run() {
  const remote = vscode.Uri.parse(
    "vscode-remote://ssh-remote+proof/workspace/plugin",
  );
  const target = comparisonUri(remote, "/workspace/plugin/src/entry.tsx");
  assert.equal(target.scheme, "vscode-remote");
  assert.equal(target.authority, remote.authority);
  assert.equal(target.path, "/workspace/plugin/src/entry.tsx");
  const extension = vscode.extensions.getExtension(
    "savia.savia-plugin-authoring",
  );
  assert.ok(extension, "Native development extension is installed");
  const api = (await extension.activate()) as Awaited<
    ReturnType<typeof activate>
  >;
  await vscode.commands.executeCommand("savia.connect");
  assert.ok(api.runtime.connections.current);
  const credentialId = api.runtime.connections.current.profile.id;
  assert.ok(
    await api.context.secrets.get(`savia.plugin-authoring.${credentialId}`),
  );
  assert.equal(api.runtime.tree.getChildren()[0].pluginId, "custom.host-proof");
  await vscode.commands.executeCommand("savia.checkout");
  assert.ok(
    (await fs.readFile(join(api.root.fsPath, "entry.tsx"), "utf8")).includes(
      "Before",
    ),
  );
  const treeRoot = api.runtime.tree.getChildren()[0];
  const version = api.runtime.tree.getChildren(treeRoot)[0];
  await vscode.commands.executeCommand("savia.inspectVersion", version);
  assert.equal(
    vscode.window.activeTextEditor?.document.uri.scheme,
    "savia-source",
  );
  await fs.writeFile(
    join(api.root.fsPath, "entry.tsx"),
    "export function render( {",
  );
  await assert.rejects((await api.runtime.ready).build());
  assert.equal(
    api.diagnostics.get(vscode.Uri.file(join(api.root.fsPath, "entry.tsx")))
      ?.length,
    1,
  );
  await fs.writeFile(
    join(api.root.fsPath, "entry.tsx"),
    'export function render(el) { el.textContent="From native VS Code"; }',
  );
  await vscode.commands.executeCommand("savia.build");
  assert.ok(api.notices.includes("buildReady"));
  await vscode.commands.executeCommand("savia.comparePublished");
  await vscode.commands.executeCommand("savia.publish");
  assert.ok(api.notices.includes("published"));
  const descriptor = JSON.parse(
    await fs.readFile(join(api.root.fsPath, ".savia/plugin.json"), "utf8"),
  );
  assert.equal(descriptor.sourceVersion, "1.1.0");
  assert.ok(
    (await fs.readFile(join(api.root.fsPath, "entry.tsx"), "utf8")).includes(
      "From native VS Code",
    ),
  );
  await vscode.commands.executeCommand("savia.disconnect");
  assert.equal(
    await api.context.secrets.get(`savia.plugin-authoring.${credentialId}`),
    undefined,
  );
  console.log(
    "Native Extension Host proof passed: connection, SecretStorage, checkout, history, diagnostics, diff, publication, disconnect.",
  );
}
