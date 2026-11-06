import type { PluginCatalogEntry } from "@savia/studio-shared/plugin-development";
import { compareSolutionVersions } from "@savia/studio-shared/solution-package";
export type PluginTreeNode = {
  kind: "plugin" | "version";
  pluginId: string;
  label: string;
  version?: string;
  latest?: boolean;
  installed?: boolean;
  authored?: boolean;
};
export class PluginTreeProvider {
  private catalog: PluginCatalogEntry[] = [];
  private listeners = new Set<() => void>();
  readonly onDidChangeTreeData = (listener: () => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  setCatalog(catalog: PluginCatalogEntry[]) {
    this.catalog = catalog;
    for (const listener of this.listeners) listener();
  }
  getChildren(parent?: PluginTreeNode): PluginTreeNode[] {
    if (!parent)
      return this.catalog.map((plugin) => ({
        kind: "plugin",
        pluginId: plugin.pluginId,
        label: plugin.label,
      }));
    if (parent.kind !== "plugin") return [];
    const plugin = this.catalog.find(
      (plugin) => plugin.pluginId === parent.pluginId,
    );
    if (!plugin) return [];
    return [...plugin.versions]
      .sort((a, b) => compareSolutionVersions(b.version, a.version))
      .map((version) => ({
        kind: "version",
        pluginId: plugin.pluginId,
        label: version.version,
        version: version.version,
        latest: version.version === plugin.head.version,
        installed: version.version === plugin.installedVersion,
        authored: version.authored,
      }));
  }
  dispose() {
    this.catalog = [];
    this.listeners.clear();
  }
}
