import { readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";

const source = new URL("../solutions/insurance/manifest.json", import.meta.url);
const target = new URL("../apps/api/src/solutions/catalog.ts", import.meta.url);
// Validate the official manifest without embedding industry names in the
// platform host. The runtime catalog owns the compiled solution; the API host
// only delegates to it (see packages/release-catalog).
const manifest = JSON.parse(await readFile(source, "utf8"));
if (manifest?.id !== "savia.insurance" || !Array.isArray(manifest?.objects)) {
  throw new Error("Invalid insurance solution manifest");
}
const code = `import { runtimeReleaseCatalog } from "@savia/release-catalog/runtime";

export const solutionOptions = {
  workflowBundles: runtimeReleaseCatalog.workflowBundles,
  solutionCatalog: runtimeReleaseCatalog.solutionCatalog,
  extensionRegistry: runtimeReleaseCatalog.extensionRegistry,
  extensionSummaryProviders: runtimeReleaseCatalog.extensionSummaryProviders,
  extensionObjectRequirements:
    runtimeReleaseCatalog.extensionObjectRequirements,
};
`;
await writeFile(target, await format(code, { parser: "typescript" }));
