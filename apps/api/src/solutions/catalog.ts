import { runtimeReleaseCatalog } from "@savia/release-catalog/runtime";

export const solutionOptions = {
  workflowBundles: runtimeReleaseCatalog.workflowBundles,
  solutionCatalog: runtimeReleaseCatalog.solutionCatalog,
  extensionRegistry: runtimeReleaseCatalog.extensionRegistry,
  extensionSummaryProviders: runtimeReleaseCatalog.extensionSummaryProviders,
  extensionObjectRequirements:
    runtimeReleaseCatalog.extensionObjectRequirements,
};
