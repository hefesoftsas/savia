// Include operational routes even though React loads them on demand. Only walk
// static imports: optional studio panels and icon catalogs must remain on demand.
const operationalRoutes = [
  "/src/app.tsx",
  "/admin/appearance-cache.ts",
  "/pwa/register-service-worker.ts",
  "/studio/studio-page.tsx",
  "/studio-engine/app.tsx",
  "/studio-engine/records.tsx",
  "/studio-engine/record-detail.tsx",
  "/studio-engine/collection-record-form.tsx",
];

type BundleItem = {
  type: string;
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: string[];
  code?: string;
};

export function collectOfflineShellAssets(bundle: Record<string, BundleItem>) {
  const assets = new Map<string, number>();
  const visit = (name: string) => {
    if (assets.has(name)) return;
    const item = bundle[name];
    if (!item || item.type !== "chunk") return;
    assets.set(name, Buffer.byteLength(item.code ?? ""));
    item.imports?.forEach(visit);
  };
  for (const item of Object.values(bundle)) {
    if (
      item.type === "chunk" &&
      ((item.isEntry && !item.facadeModuleId?.includes("/office/")) ||
        operationalRoutes.some((route) => item.facadeModuleId?.endsWith(route)))
    )
      visit(item.fileName);
  }
  return assets;
}
