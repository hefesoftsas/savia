import {
  createExtensionRegistry,
  type ExtensionObjectRequirement,
  type ExtensionRegistry,
} from "@savia/crm-shared/extension-package";
import type { ExtensionActionContext } from "@savia/crm-shared/extension-runtime";
import type { SolutionPackage } from "@savia/crm-shared/solution-package";
import { insurancePortfolioExtensionManifest } from "@savia/insurance-portfolio-dashboard/manifest";
import { insurancePortfolioAssistantExtension } from "@savia/insurance-portfolio-dashboard/mcp";
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
  solutionCatalog: readonly SolutionPackage[];
  extensionRegistry: ExtensionRegistry;
  extensionSummaryProviders: readonly ExtensionSummaryContribution[];
  extensionObjectRequirements: readonly ExtensionObjectRequirement[];
  assistantExtensions: readonly AssistantExtensionContribution[];
  connectorActions: readonly ConnectorActionContribution[];
  createConnectorActions(
    service: SaviaRequestService | undefined,
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
      throw new Error("Savia Request no está disponible para instalar Seguros.");
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
  extensionRegistry: createExtensionRegistry([
    insuranceQuotesExtension,
    { manifest: insurancePortfolioExtensionManifest },
  ]),
  extensionSummaryProviders: [
    {
      id: insurancePortfolioExtensionManifest.id,
      objectName: "polizas",
      summarize: summarizeInsurancePortfolio,
    },
  ],
  extensionObjectRequirements: [insurancePortfolioPolicyRequirement],
  assistantExtensions: [insurancePortfolioAssistantExtension],
  connectorActions: [],
  createConnectorActions: (service) => [
    createInsuranceSaviaRequestConnectorAction(service),
  ],
  beforeSolutionInstall: createInsuranceBeforeInstall,
};
