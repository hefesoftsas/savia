import {
  releaseCatalog,
  type ExtensionScreenContribution,
} from "@savia/release-catalog";
import {
  createPluginApi,
  type PluginApi,
  type PluginHostRequest,
} from "@savia/crm-shared/plugin-api";

export type { ExtensionScreenContribution } from "@savia/release-catalog";

export type ExtensionScreenInstallation = {
  manifest: { id: string };
  builtIn: boolean;
  installed: { enabled: boolean } | null;
};

const extensionScreens: readonly ExtensionScreenContribution[] =
  releaseCatalog.extensionScreens;

export function extensionApiFor(
  screen: ExtensionScreenContribution,
  request: PluginHostRequest,
): PluginApi {
  return createPluginApi({ extensionId: screen.extensionId, request });
}

export function extensionScreenFor(
  object: string,
  view: string,
): ExtensionScreenContribution | undefined {
  return extensionScreens.find(
    (screen) => screen.object === object && screen.view === view,
  );
}

export function isExtensionScreenEnabled(
  screen: ExtensionScreenContribution | undefined,
  extensions: readonly ExtensionScreenInstallation[] | undefined,
): screen is ExtensionScreenContribution {
  if (!screen || !extensions) return false;
  return extensions.some(
    (entry) =>
      entry.manifest.id === screen.extensionId &&
      (entry.builtIn || entry.installed?.enabled === true),
  );
}
