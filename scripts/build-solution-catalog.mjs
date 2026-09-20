import { readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";

const source = new URL("../solutions/insurance/manifest.json", import.meta.url);
const target = new URL("../apps/api/src/solutions/catalog.ts", import.meta.url);
const manifest = JSON.parse(await readFile(source, "utf8"));
const code = `import { solutionPackageSchema } from "@savia/crm-shared/solution-package";
import { runtimeReleaseCatalog } from "@savia/release-catalog/runtime";
// Generated from solutions/insurance/manifest.json by scripts/build-solution-catalog.mjs.
export const insuranceSolution = solutionPackageSchema.parse(${JSON.stringify(manifest)});
export const solutionOptions = {
  workflowBundles: runtimeReleaseCatalog.workflowBundles,
  solutionCatalog: [insuranceSolution],
  extensionRegistry: runtimeReleaseCatalog.extensionRegistry,
  extensionSummaryProviders: runtimeReleaseCatalog.extensionSummaryProviders,
  extensionObjectRequirements: runtimeReleaseCatalog.extensionObjectRequirements,
};
`;
await writeFile(target, await format(code, { parser: "typescript" }));
