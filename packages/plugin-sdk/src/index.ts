import type { PluginApi } from "@savia/studio-shared/plugin-api";

export type {
  PluginApi,
  PluginActionResult,
  PluginCollection,
  PluginCollectionDefinition,
  PluginCollectionListOptions,
  PluginExtensionActionRun,
  PluginExtensionConnectionSummary,
  PluginFiles,
  PluginFile,
  PluginHostRequest,
  PluginLocalCollection,
  PluginRecordPage,
  PluginRecordReceipt,
  PluginRecordVersion,
  PluginSettings,
  PluginQueryCondition,
  PluginQueryFilterOperator,
  PluginQueryFilters,
} from "@savia/studio-shared/plugin-api";
export type {
  PluginPanelApi,
  PluginPanelContext,
  PluginPanelRequest,
  PluginPanelResult,
  PluginPanelState,
} from "@savia/studio-shared/plugin-panels";
export type {
  PluginLocale,
  PluginMessages,
  PluginMessageParams,
  LocalizedContent,
  LocalizedExternalError,
} from "@savia/studio-shared/plugin-localization";
export {
  normalizePluginLocale,
  pluginIntlLocale,
  resolveLocalizedContent,
  translatePluginMessage,
} from "@savia/studio-shared/plugin-localization";
export type { PluginLookup } from "@savia/studio-shared/plugin-field-lookups";
export type {
  StudioObject,
  CollectionCapabilities,
  CollectionBindingMetadata,
  RecordSurface,
  ScreenNavigationSection,
} from "@savia/studio-shared/metadata";

export type PluginRenderContext =
  | { kind: `plugin:${string}:${string}`; collection: string }
  | { object: string; view: string };
export type PluginCleanup = () => void;
export type PluginRender = (
  element: HTMLElement,
  savia: PluginApi,
  context?: PluginRenderContext,
) => void | PluginCleanup;

export type PluginDefinition = {
  render: PluginRender;
  renderPanel?: (element: HTMLElement, savia: PluginApi) => PluginCleanup;
};

/**
 * Add consistent mount cleanup to a plugin entry point. Re-rendering the same
 * surface first disposes its previous mount, and the returned function is safe
 * to call repeatedly.
 */
export function definePlugin<T extends PluginDefinition>(plugin: T): T {
  const render = manageMounts(plugin.render);
  if (!plugin.renderPanel) return { ...plugin, render };
  const renderPanel = manageMounts(plugin.renderPanel);
  return { ...plugin, render, renderPanel };
}

function manageMounts<
  T extends (element: HTMLElement, ...args: never[]) => void | PluginCleanup,
>(render: T): T {
  const mounted = new WeakMap<HTMLElement, PluginCleanup>();
  return ((element: HTMLElement, ...args: never[]) => {
    mounted.get(element)?.();
    mounted.delete(element);
    const cleanup = render(element, ...args);
    if (typeof cleanup !== "function") return undefined;
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      if (mounted.get(element) === dispose) mounted.delete(element);
      cleanup();
    };
    mounted.set(element, dispose);
    return dispose;
  }) as T;
}
