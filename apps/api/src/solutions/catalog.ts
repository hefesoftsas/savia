import { runtimeReleaseCatalog } from "@savia/release-catalog/runtime";

export const solutionOptions = {
  solutionCatalog: runtimeReleaseCatalog.solutionCatalog,
  extensionRegistry: runtimeReleaseCatalog.extensionRegistry,
  extensionSummaryProviders: runtimeReleaseCatalog.extensionSummaryProviders,
  extensionObjectRequirements:
    runtimeReleaseCatalog.extensionObjectRequirements,
};
