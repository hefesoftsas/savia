import type { ComponentType } from "react";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import type { MyDayWidget } from "@savia/studio-shared/my-day-widgets";
import {
  runtimeReleaseCatalog,
  type AssistantExtensionContribution,
  type ConnectorActionContribution,
  type ExtensionSummaryContribution,
  type RuntimeReleaseCatalog,
} from "./runtime";

export type {
  AssistantExtensionContribution,
  ConnectorActionContribution,
  ExtensionSummaryContribution,
  RuntimeReleaseCatalog,
} from "./runtime";

export type ExtensionScreenContribution = {
  id: string;
  extensionId: string;
  object: string;
  view: string;
  hidden?: boolean;
  Screen: ComponentType<{ savia: PluginApi }>;
};

export type ExtensionResultRendererContribution = {
  extensionId: string;
  Renderer: ComponentType<{ result: unknown }>;
};

/**
 * Phase 3: plugins contribute My Day widgets the same way they contribute
 * screens. The host renders `Widget` with an already-scoped `savia`
 * object; the widget kind is persisted as
 * `plugin:<extensionId>:<widgetId>`.
 */
export type ExtensionWidgetContribution = {
  id: string;
  extensionId: string;
  collection: string;
  title: { es: string; en?: string; pt?: string };
  Widget: ComponentType<{ savia: PluginApi; widget: MyDayWidget }>;
};

export type ReleaseCatalog = RuntimeReleaseCatalog & {
  extensionScreens: readonly ExtensionScreenContribution[];
  extensionResultRenderers: readonly ExtensionResultRendererContribution[];
  extensionWidgets: readonly ExtensionWidgetContribution[];
};

/**
 * Tras la migración al store no quedan pantallas, renderers ni widgets
 * compilados: se sirven como artefactos por tenant. Se conservan los
 * tipos para compatibilidad de los slots del host.
 */
export const releaseCatalog: ReleaseCatalog = {
  ...runtimeReleaseCatalog,
  extensionScreens: [],
  extensionResultRenderers: [],
  extensionWidgets: [],
};
