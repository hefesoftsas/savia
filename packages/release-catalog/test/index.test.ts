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
      "insurance.accounting",
      "insurance.activities",
      "insurance.automation",
      "insurance.calendar",
      "insurance.campaigns",
      "insurance.carriers",
      "insurance.claims",
      "insurance.collections",
      "insurance.commissions",
      "insurance.communications",
      "insurance.compliance",
      "insurance.customer-portal",
      "insurance.data-quality",
      "insurance.document-generation",
      "insurance.documents",
      "insurance.endorsements",
      "insurance.issuance",
      "insurance.opportunities",
      "insurance.payments",
      "insurance.portfolio-dashboard",
      "insurance.quotes",
      "insurance.renewals",
      "insurance.reports",
      "insurance.service",
      "insurance.settlements",
    ]);
    expect(
      releaseCatalog.solutionCatalog.map((solution) => solution.id),
    ).toEqual(["savia.insurance"]);
    expect(
      releaseCatalog.extensionRegistry
        .get("insurance.quotes")
        ?.runtime?.actions?.map((action) => action.actionId),
    ).toEqual(["quote"]);
    expect(releaseCatalog.extensionScreens.map((screen) => screen.id)).toEqual(
      expect.arrayContaining([
        "insurance.portfolio-dashboard.policies",
        "insurance.quotes.direct",
        "insurance.quotes.wizard",
        "insurance.quotes.admin",
        "insurance.collections.worklist",
        "insurance.renewals.worklist",
        "insurance.claims.worklist",
        "insurance.commissions.worklist",
        "insurance.endorsements.worklist",
        "insurance.opportunities.worklist",
        "insurance.activities.worklist",
        "insurance.issuance.worklist",
        "insurance.documents.worklist",
        "insurance.service.worklist",
      ]),
    );
    expect(releaseCatalog.extensionRegistry.ids()).toHaveLength(25);
    for (const id of releaseCatalog.extensionRegistry
      .ids()
      .filter((id) => id !== "insurance.automation"))
      expect(
        releaseCatalog.extensionScreens.some(
          (screen) => screen.extensionId === id,
        ),
      ).toBe(true);
    expect(
      releaseCatalog.extensionResultRenderers.map(
        (renderer) => renderer.extensionId,
      ),
    ).toEqual(["insurance.quotes"]);
    // Assistant tools moved worker-side (apps/mcp): the catalog no
    // longer registers them; the tool name is covered there.
    expect(releaseCatalog.assistantExtensions).toEqual([]);
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
