import {
  createExtensionRegistry,
  type ExtensionObjectRequirement,
  type ExtensionRegistry,
} from "@savia/studio-shared/extension-package";
import type { ExtensionActionContext } from "@savia/studio-shared/extension-runtime";
import type { SolutionPackage } from "@savia/studio-shared/solution-package";
import type { SaviaRequestService } from "@savia/studio-shared/savia-request-quotes";
import type { WorkflowBundle } from "@savia/studio-shared/workflow-bundles";
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

/**
 * Catálogo compilado tras la migración al store: sin extensiones, sin
 * pantallas, sin resúmenes ni conectores. Los plugins viven como
 * artefactos por tenant (`store-ports/`, `docs/plugin-store.md`).
 * Se conserva el catálogo de soluciones (datos, sin código) y el
 * instalador de Seguros.
 */
export const runtimeReleaseCatalog: RuntimeReleaseCatalog = {
  solutionCatalog: [insuranceSolution],
  workflowBundles: [],
  extensionRegistry: createExtensionRegistry([]),
  extensionSummaryProviders: [],
  extensionObjectRequirements: [],
  assistantExtensions: [],
  connectorActions: [],
  createConnectorActions: () => [],
  beforeSolutionInstall: createInsuranceBeforeInstall,
};
