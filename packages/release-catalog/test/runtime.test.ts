import { describe, expect, it } from "vitest";
import { runtimeReleaseCatalog } from "../src/runtime";

describe("runtime release catalog", () => {
  it("ships no compiled contributions after the store migration", () => {
    expect(
      runtimeReleaseCatalog.solutionCatalog.map((solution) => solution.id),
    ).toEqual(["savia.insurance-quoter", "savia.insurance-management"]);
    expect(runtimeReleaseCatalog.connectorActions).toEqual([]);
    expect(runtimeReleaseCatalog.createConnectorActions(undefined)).toEqual([]);
    expect(runtimeReleaseCatalog.extensionSummaryProviders).toEqual([]);
    expect(runtimeReleaseCatalog.extensionObjectRequirements).toEqual([]);
    expect(runtimeReleaseCatalog.workflowBundles).toEqual([]);
    expect(runtimeReleaseCatalog.extensionRegistry.ids()).toEqual([]);
    // Assistant tools moved worker-side (apps/mcp): the catalog no
    // longer registers them; the tool name is covered there.
    expect(runtimeReleaseCatalog.assistantExtensions).toEqual([]);
  });
});
