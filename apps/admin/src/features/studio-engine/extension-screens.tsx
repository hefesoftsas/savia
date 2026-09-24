import { resolveLocalizedContent, type PluginLocale } from "@savia/studio-shared/plugin-localization";
import {
  releaseCatalog,
  type ExtensionScreenContribution,
} from "@savia/release-catalog";
import {
  createPluginApi,
  type PluginApi,
  type PluginHostRequest,
} from "@savia/studio-shared/plugin-api";

export type { ExtensionScreenContribution } from "@savia/release-catalog";

export type ExtensionScreenInstallation = {
  manifest: { id: string };
  builtIn: boolean;
  installed: { enabled: boolean } | null;
};

export type StoreScreenDeclaration = {
  object: string;
  view: string;
  hidden?: boolean;
};

export type StoreScreenInstallation = ExtensionScreenInstallation & {
  store?: boolean;
  screens?: StoreScreenDeclaration[];
};

export type StoreScreenContribution = {
  extensionId: string;
  object: string;
  view: string;
  hidden: boolean;
};

/** Pantallas declaradas por plugins del store activos en el tenant. */
export function storeScreenContributions(
  extensions: readonly StoreScreenInstallation[] | undefined,
): StoreScreenContribution[] {
  if (!extensions) return [];
  const contributions: StoreScreenContribution[] = [];
  for (const entry of extensions) {
    if (!entry.store || entry.builtIn || entry.installed?.enabled !== true)
      continue;
    for (const screen of entry.screens ?? [])
      contributions.push({
        extensionId: entry.manifest.id,
        object: screen.object,
        view: screen.view || "records",
        hidden: screen.hidden === true,
      });
  }
  return contributions;
}

export function storeScreenFor(
  object: string,
  view: string,
  extensions: readonly StoreScreenInstallation[] | undefined,
): StoreScreenContribution | undefined {
  return storeScreenContributions(extensions).find(
    (screen) => screen.object === object && screen.view === view,
  );
}

export function isStorePluginScreen(
  object: string,
  extensions: readonly StoreScreenInstallation[] | undefined,
): boolean {
  return storeScreenContributions(extensions).some(
    (screen) => screen.object === object,
  );
}

export function storeScreenDefaultHidden(
  object: string,
  extensions: readonly StoreScreenInstallation[] | undefined,
): boolean {
  const match = storeScreenContributions(extensions).find(
    (screen) => screen.object === object,
  );
  return match?.hidden === true;
}

const extensionScreens: readonly ExtensionScreenContribution[] =
  releaseCatalog.extensionScreens;

export function extensionApiFor(
  screen: ExtensionScreenContribution,
  request: PluginHostRequest,
  getLocale?: () => PluginLocale,
): PluginApi {
  return createPluginApi({
    extensionId: screen.extensionId,
    request,
    getLocale,
  });
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

export function isPluginScreen(object: string): boolean {
  return extensionScreens.some((screen) => screen.object === object);
}

export function extensionScreenContribution(
  object: string,
  view: string = "records",
): ExtensionScreenContribution | undefined {
  return extensionScreens.find(
    (screen) => screen.object === object && screen.view === view,
  );
}

export function extensionScreenDefaultHidden(object: string): boolean {
  const match = extensionScreens.find((screen) => screen.object === object);
  return match?.hidden === true;
}

/** Translate only unchanged built-in labels, preserving user-renamed screens. */
export function localizedExtensionObjectLabel(
  name: string,
  label: string,
  locale: PluginLocale,
): string {
  const requirement = releaseCatalog.extensionObjectRequirements.find(
    (item) => item.object.name === name,
  );
  if (!requirement || requirement.object.label !== label) return label;
  const manifest = releaseCatalog.extensionRegistry.get(
    requirement.id,
  )?.manifest;
  return manifest
    ? resolveLocalizedContent(label, manifest.labels, locale)
    : label;
}
