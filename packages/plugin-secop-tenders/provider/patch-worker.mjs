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

/** Add the documents tool without modifying the provider's existing handlers. */
export function patchSecopDocumentsWorker(source, addon) {
  if (source.includes("SECOP_DOCUMENTS_ADDON_START")) {
    throw new Error(
      "The Worker already contains the documents extension; update its original source instead.",
    );
  }
  const serverAnchor = "    return server;\n  });\n}";
  if (
    source.split(serverAnchor).length !== 2 ||
    !source.includes("server.registerTool(") ||
    !source.includes("function socrataFetch(") ||
    !source.includes("string2") ||
    !source.includes("number2")
  ) {
    throw new Error("Unsupported SECOP Worker source; deployment stopped.");
  }
  const patched = source.replace(
    serverAnchor,
    `    SecopDocumentsAddon.registerSecopDocumentsTool(server, { env, socrataFetch, tenderDataset: DATASETS.procesos, documentsDataset: "dmgg-8hin", stringSchema: string2, numberSchema: number2 });\n${serverAnchor}`,
  );
  const documentsAddon = `// SECOP_DOCUMENTS_ADDON_START\n${addon}\n// SECOP_DOCUMENTS_ADDON_END`;
  const catalogEnd = "// SECOP_CATALOG_ADDON_END";
  if (source.includes("SECOP_CATALOG_ADDON_START")) {
    if (source.split(catalogEnd).length !== 2) {
      throw new Error(
        "Unsupported SECOP catalog extension; deployment stopped.",
      );
    }
    return source
      .replace(catalogEnd, `${catalogEnd}\n${documentsAddon}`)
      .replace(
        serverAnchor,
        `    SecopDocumentsAddon.registerSecopDocumentsTool(server, { env, socrataFetch, tenderDataset: DATASETS.procesos, documentsDataset: "dmgg-8hin", stringSchema: string2, numberSchema: number2 });\n${serverAnchor}`,
      );
  }
  return `${documentsAddon}\n${patched}`;
}
