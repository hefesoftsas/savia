import { describe, expect, it } from "vitest";
import {
  patchSecopDocumentsWorker,
  patchSecopWorker,
} from "../provider/patch-worker.mjs";
const original = `const oauthToken = "preserve-this-binding";\nfunction string2() {}\nfunction number2() {}\nfunction socrataFetch() {}\nserver.registerTool("search", {});\n    return server;\n  });\n}\n  if (path === "/licitaciones") {\n}`;
it("adds fixed read-only catalog entry points while preserving existing provider code", () => {
  const patched = patchSecopWorker(original, "var SecopCatalogAddon = {};");
  expect(patched).toContain('server.registerTool("search", {});');
  expect(patched).toContain(
    "SecopCatalogAddon.registerSecopCatalogTool(server,",
  );
  expect(patched).toContain('if (path === "/licitaciones")');
  expect(() => patchSecopWorker(patched, "")).toThrow();
});
it("refuses to patch a provider with ambiguous or missing integration points", () => {
  expect(() => patchSecopWorker("unrelated", "")).toThrow();
  expect(() => patchSecopWorker(original + original, "")).toThrow();
});

it("adds the documents tool to an already catalog-patched worker without replacing handlers or bindings", () => {
  const catalogPatched = patchSecopWorker(
    original,
    "var SecopCatalogAddon = {};",
  );
  const patched = patchSecopDocumentsWorker(
    catalogPatched,
    "var SecopDocumentsAddon = {};",
  );

  expect(patched).toContain("SECOP_CATALOG_ADDON_START");
  expect(patched).toContain("SECOP_DOCUMENTS_ADDON_START");
  expect(patched).toContain("var SecopCatalogAddon = {};");
  expect(patched).toContain("var SecopDocumentsAddon = {};");
  expect(patched).toContain('const oauthToken = "preserve-this-binding";');
  expect(patched).toContain('server.registerTool("search", {});');
  expect(patched).toContain('if (path === "/licitaciones")');
  expect(patched).toContain(
    'SecopDocumentsAddon.registerSecopDocumentsTool(server, { env, socrataFetch, tenderDataset: DATASETS.procesos, documentsDataset: "dmgg-8hin", stringSchema: string2, numberSchema: number2 });',
  );
  expect(() => patchSecopDocumentsWorker(patched, "")).toThrow();
});

it("can add documents to the unpatched provider and refuses ambiguous or unsupported inputs", () => {
  const patched = patchSecopDocumentsWorker(
    original,
    "var SecopDocumentsAddon = {};",
  );
  expect(patched).toContain("SECOP_DOCUMENTS_ADDON_START");
  expect(patched).toContain(
    "SecopDocumentsAddon.registerSecopDocumentsTool(server,",
  );
  expect(patched).toContain('const oauthToken = "preserve-this-binding";');
  expect(() => patchSecopDocumentsWorker(original + original, "")).toThrow();
  expect(() =>
    patchSecopDocumentsWorker(
      original.replace("function number2() {}", ""),
      "",
    ),
  ).toThrow();
});
