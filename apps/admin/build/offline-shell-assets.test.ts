import { expect, it } from "vitest";
import { collectOfflineShellAssets } from "./offline-shell-assets";

it("precaches record routes and their static closure without traversing optional editors or icon catalogs", () => {
  const chunk = (
    name: string,
    facadeModuleId: string,
    imports: string[] = [],
    dynamicImports: string[] = [],
  ) => ({
    type: "chunk" as const,
    fileName: name,
    facadeModuleId,
    imports,
    dynamicImports,
    code: "code",
    isEntry: name === "entry.js",
  });
  const bundle = {
    "entry.js": chunk("entry.js", "/src/main.tsx", ["shared.js"], ["crm.js"]),
    "private-app.js": chunk("private-app.js", "/src/app.tsx", ["shared.js"]),
    "appearance.js": chunk("appearance.js", "/admin/appearance-cache.ts"),
    "registration.js": chunk(
      "registration.js",
      "/pwa/register-service-worker.ts",
    ),
    "public.js": chunk("public.js", "/public-forms/public-form-page.tsx"),
    "crm.js": chunk(
      "crm.js",
      "/dynamic-crm/crm-page.tsx",
      [],
      ["records.js", "studio.js"],
    ),
    "records.js": chunk(
      "records.js",
      "/crm-engine/records.tsx",
      ["table.js"],
      ["editor.js"],
    ),
    "detail.js": chunk("detail.js", "/crm-engine/record-detail.tsx"),
    "form.js": chunk("form.js", "/crm-engine/collection-record-form.tsx"),
    "shared.js": chunk("shared.js", "shared"),
    "table.js": chunk("table.js", "table", ["shared.js"]),
    "studio.js": chunk("studio.js", "/crm-engine/screen-manager.tsx"),
    "editor.js": chunk("editor.js", "editor", [], ["icon.js"]),
    "icon.js": chunk("icon.js", "lucide/icon"),
  };
  expect([...collectOfflineShellAssets(bundle).keys()].sort()).toEqual(
    [
      "entry.js",
      "private-app.js",
      "appearance.js",
      "registration.js",
      "crm.js",
      "records.js",
      "detail.js",
      "form.js",
      "shared.js",
      "table.js",
    ].sort(),
  );
});
