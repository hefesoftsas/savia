import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { releaseCatalog } from "../src/index";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function source(path: string): Promise<string> {
  return readFile(resolve(repository, path), "utf8");
}

describe("release catalog", () => {
  it("ships no compiled plugins after the store migration", () => {
    expect(releaseCatalog.extensionRegistry.ids()).toEqual([]);
    expect(releaseCatalog.extensionScreens).toEqual([]);
    expect(releaseCatalog.extensionResultRenderers).toEqual([]);
    expect(releaseCatalog.extensionWidgets).toEqual([]);
    expect(releaseCatalog.extensionSummaryProviders).toEqual([]);
    expect(releaseCatalog.extensionObjectRequirements).toEqual([]);
    expect(releaseCatalog.workflowBundles).toEqual([]);
    expect(releaseCatalog.connectorActions).toEqual([]);
    expect(releaseCatalog.createConnectorActions(undefined)).toEqual([]);
    // Assistant tools moved worker-side (apps/mcp): the catalog no
    // longer registers them; the tool name is covered there.
    expect(releaseCatalog.assistantExtensions).toEqual([]);
  });

  it("keeps the data-only insurance solution catalog", () => {
    expect(
      releaseCatalog.solutionCatalog.map((solution) => solution.id),
    ).toEqual(["savia.insurance"]);
  });

  it("keeps industry names outside the platform hosts", async () => {
    for (const path of [
      "apps/api/src/extensions/catalog.ts",
      "apps/api/src/solutions/catalog.ts",
      "apps/admin/src/features/studio-engine/extension-screens.tsx",
      "apps/mcp/src/extensions/registry.ts",
    ])
      await expect(source(path)).resolves.not.toMatch(/insurance/i);
  });
});
