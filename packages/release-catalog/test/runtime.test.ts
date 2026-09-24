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
    ).toEqual(
      expect.arrayContaining([
        "quote",
        "send",
        "request-signature",
        "signature-status",
      ]),
    );
    expect(
      runtimeReleaseCatalog.extensionSummaryProviders.map(
        (provider) => provider.id,
      ),
    ).toEqual(["insurance.portfolio-dashboard"]);
    // Assistant tools moved worker-side (apps/mcp): the catalog no
    // longer registers them; the tool name is covered there.
    expect(runtimeReleaseCatalog.assistantExtensions).toEqual([]);
  });
});
