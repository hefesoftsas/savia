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
  it("assembles the optional insurance solution without involving platform hosts", () => {
    expect(releaseCatalog.extensionRegistry.ids()).toEqual([
      "insurance.portfolio-dashboard",
      "insurance.quotes",
    ]);
    expect(
      releaseCatalog.solutionCatalog.map((solution) => solution.id),
    ).toEqual(["savia.insurance"]);
    expect(
      releaseCatalog.extensionRegistry
        .get("insurance.quotes")
        ?.runtime?.actions?.map((action) => action.actionId),
    ).toEqual(["quote"]);
    expect(releaseCatalog.extensionScreens.map((screen) => screen.id)).toEqual([
      "insurance.portfolio-dashboard.policies",
      "insurance.quotes.direct",
      "insurance.quotes.wizard",
      "insurance.quotes.admin",
    ]);
    expect(
      releaseCatalog.extensionResultRenderers.map(
        (renderer) => renderer.extensionId,
      ),
    ).toEqual(["insurance.quotes"]);
    expect(
      releaseCatalog.assistantExtensions.map((extension) => extension.id),
    ).toEqual(["insurance.portfolio-dashboard"]);
  });

  it("keeps industry names outside the platform hosts", async () => {
    for (const path of [
      "apps/api/src/extensions/catalog.ts",
      "apps/api/src/solutions/catalog.ts",
      "apps/admin/src/features/crm-engine/extension-screens.tsx",
      "apps/mcp/src/extensions/registry.ts",
    ])
      await expect(source(path)).resolves.not.toMatch(/insurance/i);
  });
});
