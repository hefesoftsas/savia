// Test-only fixture for the legacy extension engine. Production imports
// runtime.ts, whose compiled extension registry is intentionally empty.
import { extension as paymentsContribution } from "@savia/insurance-payments/manifest";
import { requirement as paymentsRequirement } from "@savia/insurance-payments/object";
import { extension as settlementsContribution } from "@savia/insurance-settlements/manifest";
import { requirement as settlementsRequirement } from "@savia/insurance-settlements/object";
import { extension as accountingContribution } from "@savia/insurance-accounting/manifest";
import { requirement as accountingRequirement } from "@savia/insurance-accounting/object";
import { extension as communicationsContribution } from "@savia/insurance-communications/manifest";
import { requirement as communicationsRequirement } from "@savia/insurance-communications/object";
import { createConnectorActions as communicationsActions } from "@savia/insurance-communications/connectors";
import { extension as carriersContribution } from "@savia/insurance-carriers/manifest";
import { requirement as carriersRequirement } from "@savia/insurance-carriers/object";
import { createConnectorActions as carriersActions } from "@savia/insurance-carriers/connectors";
import { extension as calendarContribution } from "@savia/insurance-calendar/manifest";
import { requirement as calendarRequirement } from "@savia/insurance-calendar/object";
import { createConnectorActions as calendarActions } from "@savia/insurance-calendar/connectors";
import { extension as campaignsContribution } from "@savia/insurance-campaigns/manifest";
import { requirement as campaignsRequirement } from "@savia/insurance-campaigns/object";
import { createConnectorActions as campaignsActions } from "@savia/insurance-campaigns/connectors";
import { extension as documentGenerationContribution } from "@savia/insurance-document-generation/manifest";
import { requirement as documentGenerationRequirement } from "@savia/insurance-document-generation/object";
import { createConnectorActions as documentGenerationActions } from "@savia/insurance-document-generation/connectors";
import { manifest as dataQualityContribution } from "@savia/insurance-data-quality/manifest";
import { requirement as dataQualityRequirement } from "@savia/insurance-data-quality/object";
import { manifest as reportsContribution } from "@savia/insurance-reports/manifest";
import { requirement as reportsRequirement } from "@savia/insurance-reports/object";
import { extension as complianceContribution } from "@savia/insurance-compliance/manifest";
import { requirement as complianceRequirement } from "@savia/insurance-compliance/object";
import { manifest as customerPortalContribution } from "@savia/insurance-customer-portal/manifest";
import { requirement as customerPortalRequirement } from "@savia/insurance-customer-portal/object";
import type { WorkflowBundle } from "@savia/studio-shared/workflow-bundles";
import { bundles } from "@savia/insurance-automation/bundles";
import { manifest as automationManifest } from "@savia/insurance-automation/manifest";
import { manifest as issuanceManifest } from "@savia/insurance-issuance/manifest";
import { requirement as issuanceRequirement } from "@savia/insurance-issuance/object";
import { manifest as documentsManifest } from "@savia/insurance-documents/manifest";
import { requirement as documentsRequirement } from "@savia/insurance-documents/object";
import { manifest as serviceManifest } from "@savia/insurance-service/manifest";
import { requirement as serviceRequirement } from "@savia/insurance-service/object";
import { manifest as claimsManifest } from "@savia/insurance-claims/manifest";
import { requirement as claimsRequirement } from "@savia/insurance-claims/object";
import { manifest as commissionsManifest } from "@savia/insurance-commissions/manifest";
import { requirement as commissionsRequirement } from "@savia/insurance-commissions/object";
import { manifest as endorsementsManifest } from "@savia/insurance-endorsements/manifest";
import { requirement as endorsementsRequirement } from "@savia/insurance-endorsements/object";
import { manifest as opportunitiesManifest } from "@savia/insurance-opportunities/manifest";
import { requirement as opportunitiesRequirement } from "@savia/insurance-opportunities/object";
import { manifest as activitiesManifest } from "@savia/insurance-activities/manifest";
import { requirement as activitiesRequirement } from "@savia/insurance-activities/object";
import { manifest as collectionsManifest } from "@savia/insurance-collections/manifest";
import { requirement as collectionsRequirement } from "@savia/insurance-collections/object";
import { manifest as renewalsManifest } from "@savia/insurance-renewals/manifest";
import { requirement as renewalsRequirement } from "@savia/insurance-renewals/object";
import {
  createExtensionRegistry,
  type ExtensionObjectRequirement,
  type ExtensionRegistry,
} from "@savia/studio-shared/extension-package";
import type { ExtensionActionContext } from "@savia/studio-shared/extension-runtime";
import type { SolutionPackage } from "@savia/studio-shared/solution-package";
import { insurancePortfolioExtensionManifest } from "@savia/insurance-portfolio-dashboard/manifest";
import { insurancePortfolioPolicyRequirement } from "@savia/insurance-portfolio-dashboard/policy-object";
import { summarizeInsurancePortfolio } from "@savia/insurance-portfolio-dashboard/summary";
import {
  createInsuranceSaviaRequestConnectorAction,
  type SaviaRequestService,
} from "@savia/insurance-quotes/savia-request-adapter";
import { insuranceQuotesExtension } from "@savia/insurance-quotes/manifest";
import { insuranceSolution } from "@savia/insurance-quotes/solution";

export type AssistantExtensionContribution = {
  id: string;
  register(input: any): void;
};

export type ExtensionSummaryContribution = {
  id: string;
  objectName: string;
  summarize(records: readonly Record<string, unknown>[], asOf: string): unknown;
};

export type ConnectorActionContribution = {
  extensionId: string;
  actionId: string;
  execute(input: {
    context: ExtensionActionContext;
    connection: Record<string, unknown>;
    input: Record<string, unknown>;
  }): Promise<unknown>;
};

export type RuntimeReleaseCatalog = {
  workflowBundles: readonly WorkflowBundle[];
  solutionCatalog: readonly SolutionPackage[];
  extensionRegistry: ExtensionRegistry;
  extensionSummaryProviders: readonly ExtensionSummaryContribution[];
  extensionObjectRequirements: readonly ExtensionObjectRequirement[];
  assistantExtensions: readonly AssistantExtensionContribution[];
  connectorActions: readonly ConnectorActionContribution[];
  createConnectorActions(
    service: SaviaRequestService | undefined,
    options?: { allowedOrigins?: readonly string[] },
  ): readonly ConnectorActionContribution[];
  beforeSolutionInstall(
    service: SaviaRequestService | undefined,
  ): (manifest: SolutionPackage) => Promise<void>;
};

function createInsuranceBeforeInstall(
  service: SaviaRequestService | undefined,
) {
  return async (manifest: SolutionPackage) => {
    if (manifest.id !== insuranceSolution.id) return;
    if (!service)
      throw new Error(
        "Savia Request no está disponible para instalar Seguros.",
      );
    let response: Response;
    try {
      response = await service.fetch(
        new Request(
          "https://savia-request.internal/api/bundles/insurance-auto-light/ensure",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          },
        ),
      );
    } catch {
      throw new Error("No se pudo preparar Savia Request para Seguros.");
    }
    if (!response.ok)
      throw new Error("No se pudo preparar Savia Request para Seguros.");
  };
}

export const runtimeReleaseCatalog: RuntimeReleaseCatalog = {
  solutionCatalog: [insuranceSolution],
  workflowBundles: bundles.map((bundle) => ({
    ...bundle,
    extensionId: automationManifest.id,
  })),
  extensionRegistry: createExtensionRegistry([
    paymentsContribution,
    settlementsContribution,
    accountingContribution,
    communicationsContribution,
    carriersContribution,
    calendarContribution,
    campaignsContribution,
    documentGenerationContribution,
    { manifest: dataQualityContribution },
    { manifest: reportsContribution },
    complianceContribution,
    { manifest: customerPortalContribution },

    insuranceQuotesExtension,
    { manifest: automationManifest },
    { manifest: collectionsManifest },
    { manifest: claimsManifest },
    { manifest: commissionsManifest },
    { manifest: endorsementsManifest },
    { manifest: opportunitiesManifest },
    { manifest: activitiesManifest },
    { manifest: issuanceManifest },
    { manifest: documentsManifest },
    { manifest: serviceManifest },

    { manifest: renewalsManifest },
    { manifest: insurancePortfolioExtensionManifest },
  ]),
  extensionSummaryProviders: [
    {
      id: insurancePortfolioExtensionManifest.id,
      objectName: "polizas",
      summarize: summarizeInsurancePortfolio,
    },
  ],
  extensionObjectRequirements: [
    paymentsRequirement,
    settlementsRequirement,
    accountingRequirement,
    communicationsRequirement,
    carriersRequirement,
    calendarRequirement,
    campaignsRequirement,
    documentGenerationRequirement,
    dataQualityRequirement,
    reportsRequirement,
    complianceRequirement,
    customerPortalRequirement,

    insurancePortfolioPolicyRequirement,
    collectionsRequirement,
    claimsRequirement,
    commissionsRequirement,
    endorsementsRequirement,
    opportunitiesRequirement,
    activitiesRequirement,
    issuanceRequirement,
    documentsRequirement,
    serviceRequirement,

    renewalsRequirement,
  ],
  assistantExtensions: [],
  connectorActions: [],
  createConnectorActions: (service, options = {}) => [
    ...communicationsActions(options),
    ...carriersActions(options),
    ...calendarActions(options),
    ...campaignsActions(options),
    ...documentGenerationActions(options),

    createInsuranceSaviaRequestConnectorAction(service),
  ],
  beforeSolutionInstall: createInsuranceBeforeInstall,
};
