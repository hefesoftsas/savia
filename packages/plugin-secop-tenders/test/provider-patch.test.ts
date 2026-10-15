import { describe, expect, it } from "vitest";
import { patchSecopWorker } from "../provider/patch-worker.mjs";
const original = `function socrataFetch() {}\nserver.registerTool("search", {});\n    return server;\n  });\n}\n  if (path === "/licitaciones") {\n}`;
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
