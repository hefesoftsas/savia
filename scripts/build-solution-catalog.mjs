import { readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";

const sources = [
  ["../solutions/insurance-quoter/manifest.json", "savia.insurance-quoter"],
  [
    "../solutions/insurance-management/manifest.json",
    "savia.insurance-management",
  ],
];
const target = new URL("../apps/api/src/solutions/catalog.ts", import.meta.url);
// Validate the official manifests without embedding industry names in the
// platform host. The runtime catalog owns the compiled solution; the API host
// only delegates to it (see packages/release-catalog).
for (const [path, id] of sources) {
  const manifest = JSON.parse(
    await readFile(new URL(path, import.meta.url), "utf8"),
  );
  if (manifest?.id !== id || !Array.isArray(manifest?.objects)) {
    throw new Error(`Invalid solution manifest: ${id}`);
  }
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
