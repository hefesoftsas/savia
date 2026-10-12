import * as vscode from "vscode";
import { basename } from "node:path";
import { compareSolutionVersions } from "@savia/studio-shared/solution-package";
import {
  pluginVersionSchema,
  pluginDevelopmentOriginSchema,
} from "@savia/studio-shared/plugin-development";
import type { AuthoringUi, PublicationSummary } from "./controller";
import type { ProjectRoot } from "./filesystem";
import type { ConnectionProfile } from "./client";
import { localeFor, translator } from "./i18n";
const t = translator(localeFor(vscode.env.language));
export const uriForRoot = (root: ProjectRoot): vscode.Uri =>
  "with" in root ? (root as vscode.Uri) : vscode.Uri.file(root.fsPath);
export type ConnectionSelection =
  | { kind: "saved"; profile: ConnectionProfile }
  | { kind: "new"; origin: string; tenantId: number; token: string };
export async function chooseConnection(
  profiles: ConnectionProfile[],
): Promise<ConnectionSelection | undefined> {
  const items = [
    {
      label: t("newConnection"),
      profile: undefined as ConnectionProfile | undefined,
    },
    ...profiles.map((profile) => ({
      label: `${profile.origin} · ${profile.tenantId}`,
      description: profile.principalId,
      profile,
    })),
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title: t("connect"),
    ignoreFocusOut: true,
  });
  if (!selected) return;
  if (selected.profile) return { kind: "saved", profile: selected.profile };
  const originInput = await vscode.window.showInputBox({
    title: t("connect"),
    prompt: t("server"),
    value: "https://savia-team.savia-preview.hefesoft.com",
    ignoreFocusOut: true,
    validateInput: (value) =>
      pluginDevelopmentOriginSchema.safeParse(value.trim().replace(/\/$/, ""))
        .success
        ? undefined
        : t("originError"),
  });
  if (originInput === undefined) return;
  const tenantInput = await vscode.window.showInputBox({
    title: t("connect"),
    prompt: t("workspaceId"),
    ignoreFocusOut: true,
    validateInput: (value) =>
      /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
        ? undefined
        : t("workspaceError"),
  });
  if (tenantInput === undefined) return;
  const token = await vscode.window.showInputBox({
    title: t("key"),
    prompt: t("keyHint"),
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) =>
      /^[\x21-\x7e]+$/.test(value) ? undefined : t("key"),
  });
  if (token === undefined) return;
  return {
    kind: "new",
    origin: originInput.trim().replace(/\/$/, ""),
    tenantId: Number(tenantInput),
    token,
  };
}
export function createNativeUi(
  diagnostics: vscode.DiagnosticCollection,
): AuthoringUi {
  return {
    isTrusted: () => vscode.workspace.isTrusted,
    projectRoots: () =>
      vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [],
    saveAll: () => vscode.workspace.saveAll(false),
    async pickRoot(roots) {
      return (
        await vscode.window.showQuickPick(
          roots.map((root) => ({
            label: basename(root.fsPath),
            description: root.fsPath,
            root,
          })),
          { title: t("root"), ignoreFocusOut: true },
        )
      )?.root;
    },
    async chooseDestination(destinations, workspaceLabel) {
      return (
        await vscode.window.showQuickPick(
          destinations.map((destination) => ({
            label: t(destination),
            description: destination === "tenant" ? workspaceLabel : undefined,
            destination,
          })),
          { title: t("destination"), ignoreFocusOut: true },
        )
      )?.destination;
    },
    chooseVersion: (suggested, minimum) =>
      vscode.window.showInputBox({
        title: t("version"),
        value: suggested,
        prompt: t("versionHint", { minimum }),
        ignoreFocusOut: true,
        validateInput: (value) =>
          pluginVersionSchema.safeParse(value).success &&
          compareSolutionVersions(value, minimum) > 0
            ? undefined
            : t("versionHint", { minimum }),
      }),
    async confirmPublication(summary: PublicationSummary) {
      const action = summary.rebase
        ? t("updateBase")
        : summary.recovery
          ? t("retry")
          : t("publish");
      const title = t(summary.rebase ? "confirmBase" : "confirm", {
        pluginId: summary.pluginId,
        version: summary.version,
        target:
          summary.destination === "tenant"
            ? summary.workspaceLabel
            : t("shared"),
      });
      const details = [
        t("sourceBase", {
          sourceVersion: summary.sourceVersion,
          sha256: summary.sha256,
        }),
        summary.rebase
          ? t("keepLocalFiles")
          : summary.recovery
            ? t("retained")
            : t("changes") +
              "\n" +
              summary.changes
                .map((change) => `${change.kind}: ${change.path}`)
                .join("\n"),
        t("noActivation"),
      ].join("\n\n");
      return (
        (await vscode.window.showInformationMessage(
          title,
          { modal: true, detail: details },
          action,
        )) === action
      );
    },
    diagnostics(items, root) {
      diagnostics.clear();
      if (!root) return;
      const grouped = new Map<string, vscode.Diagnostic[]>();
      for (const item of items) {
        const uri = vscode.Uri.joinPath(
          uriForRoot(root),
          ...item.path.split("/"),
        );
        const key = uri.toString();
        const entries = grouped.get(key) ?? [];
        entries.push(
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
        );
        grouped.set(key, entries);
      }
      for (const [uri, entries] of grouped)
        diagnostics.set(vscode.Uri.parse(uri), entries);
    },
    async pickPlugin(catalog) {
      if (!catalog.length) {
        await vscode.window.showInformationMessage(t("noPlugins"));
        return;
      }
      return (
        await vscode.window.showQuickPick(
          catalog.map((plugin) => ({
            label: plugin.label,
            description: plugin.pluginId,
            pluginId: plugin.pluginId,
          })),
          { title: t("plugin"), ignoreFocusOut: true },
        )
      )?.pluginId;
    },
    async pickFile(files) {
      return (
        await vscode.window.showQuickPick(
          files.map((file) => ({ label: file.path, path: file.path })),
          { title: t("sourceFile"), ignoreFocusOut: true },
        )
      )?.path;
    },
    async chooseFolder() {
      return (
        await vscode.window.showOpenDialog({
          title: t("folder"),
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
        })
      )?.[0];
    },
    async openFile(root, path) {
      const uri = uriForRoot(root);
      if (
        !vscode.workspace.workspaceFolders?.some(
          (folder) => folder.uri.toString() === uri.toString(),
        )
      )
        vscode.workspace.updateWorkspaceFolders(
          vscode.workspace.workspaceFolders?.length ?? 0,
          0,
          { uri },
        );
      await vscode.window.showTextDocument(
        vscode.Uri.joinPath(uri, ...path.split("/")),
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
    async chooseAttempt(attempts) {
      if (!attempts.length) {
        await vscode.window.showInformationMessage(t("noAttempts"));
        return;
      }
      return (
        await vscode.window.showQuickPick(
          attempts.map((attempt) => ({
            label: `${attempt.input.pluginId}@${attempt.input.version}`,
            description: t(attempt.input.destination),
            detail: attempt.sha256,
            sha256: attempt.sha256,
          })),
          { title: t("selectAttempt"), ignoreFocusOut: true },
        )
      )?.sha256;
    },
    async notify(code, values = {}) {
      const translated = { ...values };
      for (const field of ["latest", "sharedLatest"])
        if (translated[field]) translated[field] = t(translated[field]);
      const message = t(code, translated);
      if (
        ["shared-pending", "shared-conflict", "baselineNotUpdated"].includes(
          code,
        )
      )
        void vscode.window.showWarningMessage(message);
      else void vscode.window.showInformationMessage(message);
    },
  };
}
