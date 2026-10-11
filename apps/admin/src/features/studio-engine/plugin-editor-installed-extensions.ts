import { ExtensionIdentifier } from "@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions";
import {
  registerExtension,
  ExtensionHostKind,
  type IExtensionManifest,
} from "@codingame/monaco-vscode-api/extensions";
import {
  parseEditorVsix,
  type ParsedEditorVsix,
} from "@savia/studio-shared/plugin-editor-vsix";
import {
  PLUGIN_EDITOR_VSCODE_VERSION,
  type ProjectEditorExtensionReference,
} from "@savia/studio-shared/plugin-editor-extensions";
import { getService } from "@codingame/monaco-vscode-api";
import { IExtensionService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions.service";

type Active = {
  package: ParsedEditorVsix;
  isDisposed(): boolean;
  dispose(): Promise<void>;
};
export class InstalledEditorExtensionManager {
  private packages = new Map<string, ParsedEditorVsix>();
  private active = new Map<string, Active>();
  constructor(
    private readonly isolated: boolean,
    private readonly onHostRestarted: () => Promise<void> = async () => {},
  ) {}
  async receive(
    installationId: string,
    sha256: string,
    bytes: Uint8Array,
  ): Promise<void> {
    if (!this.isolated)
      throw new Error(
        "Third-party extensions require the isolated editor host.",
      );
    const parsed = await parseEditorVsix(bytes, PLUGIN_EDITOR_VSCODE_VERSION);
    if (
      parsed.metadata.sha256 !== sha256 ||
      !parsed.metadata.compatibility.supported
    )
      throw new Error(
        parsed.metadata.compatibility.reason ?? "Package digest mismatch.",
      );
    this.packages.set(installationId, parsed);
  }
  async enable(reference: ProjectEditorExtensionReference): Promise<void> {
    const parsed = this.packages.get(reference.installationId);
    if (!parsed || parsed.metadata.sha256 !== reference.sha256)
      throw new Error("Extension package is not available.");
    if (this.active.has(reference.installationId)) return;
    for (const dependency of parsed.metadata.dependencies)
      if (
        ![...this.active.values()].some(
          (item) => item.package.metadata.id === dependency,
        )
      )
        throw new Error(`Missing enabled dependency: ${dependency}`);
    const previous = [...this.active.entries()].find(
      ([, item]) => item.package.metadata.id === parsed.metadata.id,
    );
    if (previous) await this.disable(previous[0]);
    try {
      await this.register(reference.installationId, parsed);
    } catch (error) {
      if (previous) await this.register(previous[0], previous[1].package);
      throw error;
    }
  }
  private async register(id: string, parsed: ParsedEditorVsix) {
    const extension = registerExtension(
      parsed.manifest as unknown as IExtensionManifest,
      ExtensionHostKind.LocalWebWorker,
    );
    const resources: { dispose(): void }[] = [];
    const urls: string[] = [];
    let disposed = false;
    const dispose = async () => {
      const service = await getService(IExtensionService);
      const executable = !!parsed.manifest.browser;
      if (executable) {
        // Pinned VS Code API implementation supports an automatic stop without UI prompts.
        const stoppable = service as typeof service & {
          stopExtensionHosts(reason: string, auto: boolean): Promise<boolean>;
        };
        if (
          !(await stoppable.stopExtensionHosts(
            "Changing installed editor extensions",
            true,
          ))
        )
          throw new Error("Extension host refused to stop.");
      }
      disposed = true;
      await extension.dispose();
      for (const resource of resources) resource.dispose();
      for (const url of urls) URL.revokeObjectURL(url);
      if (executable) {
        await service.startExtensionHosts();
        await this.onHostRestarted();
        for (const active of this.active.values())
          if (active.package.manifest.browser)
            await this.activate(active.package.metadata.id);
      }
    };
    try {
      for (const [path, bytes] of parsed.files) {
        if (!path.startsWith("extension/")) continue;
        const relative = path.slice("extension/".length);
        const mime = /\.(?:js|mjs|cjs)$/.test(path)
          ? "text/javascript"
          : /\.json$/.test(path)
            ? "application/json"
            : "application/octet-stream";
        const owned = new Uint8Array(bytes.length);
        owned.set(bytes);
        const url = URL.createObjectURL(
          new Blob([owned.buffer], { type: mime }),
        );
        urls.push(url);
        resources.push(extension.registerFileUrl(relative, url, mime));
      }
      await extension.whenReady();
      if (parsed.manifest.browser) {
        await this.activate(parsed.metadata.id);
      }
      this.active.set(id, {
        package: parsed,
        dispose,
        isDisposed: () => disposed,
      });
    } catch (error) {
      await dispose();
      throw error;
    }
  }
  private async activate(id: string) {
    const service = await getService(IExtensionService);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        service.activateById(new ExtensionIdentifier(id), {
          startup: false,
          extensionId: new ExtensionIdentifier(id),
          activationEvent: "savia:explicit-install",
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Extension activation timed out: ${id}`)),
            10000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const status = service.getExtensionsStatus()[id];
    if (!status?.activationTimes)
      throw new Error(`Extension activation failed: ${id}`);
    if (status?.runtimeErrors?.length)
      throw new Error(String(status.runtimeErrors[0]));
  }
  preferredTheme(isDark: boolean): string | undefined {
    for (const active of [...this.active.values()].reverse()) {
      const contributions = active.package.manifest.contributes as
        { themes?: { label?: string; uiTheme?: string }[] } | undefined;
      for (const theme of Array.isArray(contributions?.themes)
        ? contributions.themes
        : [])
        if (
          typeof theme.label === "string" &&
          (isDark
            ? theme.uiTheme === "vs-dark" || theme.uiTheme === "hc-black"
            : theme.uiTheme === "vs" || theme.uiTheme === "hc-light")
        )
          return theme.label;
    }
    return undefined;
  }
  async synchronize(references: ProjectEditorExtensionReference[]) {
    const pending = references.filter(
      (ref) => !this.active.has(ref.installationId),
    );
    while (pending.length) {
      const index = pending.findIndex((ref) => {
        const pkg = this.packages.get(ref.installationId);
        return (
          pkg &&
          pkg.metadata.dependencies.every((dep) =>
            [...this.active.values()].some(
              (item) => item.package.metadata.id === dep,
            ),
          )
        );
      });
      if (index < 0)
        throw new Error(
          "Extension packages have missing or circular dependencies.",
        );
      const [reference] = pending.splice(index, 1);
      await this.enable(reference);
    }
    for (const id of this.active.keys())
      if (!references.some((ref) => ref.installationId === id))
        await this.disable(id);
  }
  async disable(id: string) {
    const active = this.active.get(id);
    if (!active) return;
    this.active.delete(id);
    try {
      await active.dispose();
    } catch (error) {
      if (!active.isDisposed()) this.active.set(id, active);
      throw error;
    }
  }
  async dispose() {
    for (const id of this.active.keys()) await this.disable(id);
    this.packages.clear();
  }
}
