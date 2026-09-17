import { describe, expect, it } from "vitest";
import { runtimeReleaseCatalog } from "../src/runtime";

describe("runtime release catalog", () => {
  it("supplies runtime-only solution contributions without connector actions", () => {
    expect(
      runtimeReleaseCatalog.solutionCatalog.map((solution) => solution.id),
    ).toEqual(["savia.insurance"]);
    expect(
      runtimeReleaseCatalog.connectorActions.map((action) => action.actionId),
    ).toEqual([]);
    expect(
      runtimeReleaseCatalog
        .createConnectorActions(undefined)
        .map((action) => action.actionId),
    ).toEqual(["quote"]);
    expect(
      runtimeReleaseCatalog.extensionSummaryProviders.map(
        (provider) => provider.id,
      ),
    ).toEqual(["insurance.portfolio-dashboard"]);
    expect(
      runtimeReleaseCatalog.assistantExtensions.map(
        (extension) => extension.id,
      ),
    ).toEqual(["insurance.portfolio-dashboard"]);
  });
});
