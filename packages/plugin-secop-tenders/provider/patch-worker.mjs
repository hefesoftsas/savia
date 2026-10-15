/** Add the catalog extension to the inspected SECOP Live provider bundle. */
export function patchSecopWorker(source, addon) {
  if (source.includes("SECOP_CATALOG_ADDON_START")) {
    throw new Error(
      "The Worker already contains the catalog extension; update its original source instead.",
    );
  }
  const serverAnchor = "    return server;\n  });\n}";
  if (
    source.split(serverAnchor).length !== 2 ||
    !source.includes("server.registerTool(") ||
    !source.includes("function socrataFetch(")
  ) {
    throw new Error("Unsupported SECOP Worker source; deployment stopped.");
  }
  const patched = source.replace(
    serverAnchor,
    `    SecopCatalogAddon.registerSecopCatalogTool(server, { env, socrataFetch, dataset: DATASETS.procesos, stringSchema: string2, waitUntil: secopCatalogWaitUntil });\n${serverAnchor}`,
  );
  return `import { waitUntil as secopCatalogWaitUntil } from "cloudflare:workers";\n// SECOP_CATALOG_ADDON_START\n${addon}\n// SECOP_CATALOG_ADDON_END\n${patched}`;
}
