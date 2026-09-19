import { screens as paymentsScreens } from "@savia/insurance-payments/admin";
import { screens as settlementsScreens } from "@savia/insurance-settlements/admin";
import { screens as accountingScreens } from "@savia/insurance-accounting/admin";
import { screens as communicationsScreens } from "@savia/insurance-communications/admin";
import { screens as carriersScreens } from "@savia/insurance-carriers/admin";
import { screens as calendarScreens } from "@savia/insurance-calendar/admin";
import { screens as campaignsScreens } from "@savia/insurance-campaigns/admin";
import { screens as documentGenerationScreens } from "@savia/insurance-document-generation/admin";
import { screens as dataQualityScreens } from "@savia/insurance-data-quality/admin";
import { screens as reportsScreens } from "@savia/insurance-reports/admin";
import { screens as complianceScreens } from "@savia/insurance-compliance/admin";
import { screens as customerPortalScreens } from "@savia/insurance-customer-portal/admin";
import { screens as issuanceScreens } from "@savia/insurance-issuance/admin";
import { screens as documentsScreens } from "@savia/insurance-documents/admin";
import { screens as serviceScreens } from "@savia/insurance-service/admin";
import { screens as claimsScreens } from "@savia/insurance-claims/admin";
import { screens as commissionsScreens } from "@savia/insurance-commissions/admin";
import { screens as endorsementsScreens } from "@savia/insurance-endorsements/admin";
import { screens as opportunitiesScreens } from "@savia/insurance-opportunities/admin";
import { screens as activitiesScreens } from "@savia/insurance-activities/admin";
import { screens as collectionsScreens } from "@savia/insurance-collections/admin";
import { screens as renewalsScreens } from "@savia/insurance-renewals/admin";
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
  hidden?: boolean;
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
  extensionScreens: [
    ...paymentsScreens,
    ...settlementsScreens,
    ...accountingScreens,
    ...communicationsScreens,
    ...carriersScreens,
    ...calendarScreens,
    ...campaignsScreens,
    ...documentGenerationScreens,
    ...dataQualityScreens,
    ...reportsScreens,
    ...complianceScreens,
    ...customerPortalScreens,

    ...insurancePortfolioScreens,
    ...insuranceQuoteScreens,
    ...collectionsScreens,
    ...renewalsScreens,
    ...claimsScreens,
    ...commissionsScreens,
    ...endorsementsScreens,
    ...opportunitiesScreens,
    ...activitiesScreens,
    ...issuanceScreens,
    ...documentsScreens,
    ...serviceScreens,
  ],
  extensionResultRenderers: insuranceQuoteResultRenderers,
};
