import type { ComponentType } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { insurancePortfolioScreens } from "@savia/insurance-portfolio-dashboard/admin";
import {
  insuranceQuoteResultRenderers,
  insuranceQuoteScreens,
} from "@savia/insurance-quotes/admin";
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
  Screen: ComponentType<{ savia: PluginApi }>;
};

export type ExtensionResultRendererContribution = {
  extensionId: string;
  Renderer: ComponentType<{ result: unknown }>;
};

export type ReleaseCatalog = RuntimeReleaseCatalog & {
  extensionScreens: readonly ExtensionScreenContribution[];
  extensionResultRenderers: readonly ExtensionResultRendererContribution[];
};

export const releaseCatalog: ReleaseCatalog = {
  ...runtimeReleaseCatalog,
  extensionScreens: [...insurancePortfolioScreens, ...insuranceQuoteScreens],
  extensionResultRenderers: insuranceQuoteResultRenderers,
};
