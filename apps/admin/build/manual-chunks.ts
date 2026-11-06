export function saviaManualChunk(id: string): string | undefined {
  const normalized = id.replaceAll("\0", "").replaceAll("\\", "/");
  // Shared by optional catalogs and eager brand icons. Keep this factory out
  // of the extension host when manual chunks collect transitive dependencies.
  if (normalized.endsWith("/compact-brand-icon.ts")) return "icons";
  // Keep Vite's shared dynamic-import helper out of the optional host.
  if (normalized.includes("vite/preload-helper"))
    return "modulepreload-polyfill";
  const clean = normalized.split("?")[0]!;
  const lastNodeModules = clean.lastIndexOf("/node_modules/");
  if (lastNodeModules === -1) return undefined;
  const pkgPath = clean.slice(lastNodeModules + "/node_modules/".length);
  // The extension host lives in a separate document. Do not pull its
  // services into the shared app vendor chunk or offline shell.
  if (
    pkgPath.startsWith("@codingame/") ||
    pkgPath.startsWith("@vscode/") ||
    pkgPath === "prettier" ||
    pkgPath.startsWith("prettier/") ||
    pkgPath === "vscode-oniguruma" ||
    pkgPath.startsWith("vscode-oniguruma/") ||
    pkgPath === "vscode-textmate" ||
    pkgPath.startsWith("vscode-textmate/")
  )
    return "plugin-editor-vendor";
  if (
    pkgPath.startsWith("lucide-react/dist/esm/icons/") ||
    pkgPath.startsWith("@thesvg/react/dist/")
  )
    return undefined;
  if (
    pkgPath === "lucide-react" ||
    pkgPath.startsWith("lucide-react/") ||
    pkgPath.startsWith("@thesvg/") ||
    pkgPath === "lucide" ||
    pkgPath.startsWith("lucide/")
  )
    return "icons";
  if (
    pkgPath === "react" ||
    pkgPath.startsWith("react/") ||
    pkgPath === "react-dom" ||
    pkgPath.startsWith("react-dom/") ||
    pkgPath === "react-router" ||
    pkgPath.startsWith("react-router/") ||
    pkgPath === "react-router-dom" ||
    pkgPath.startsWith("react-router-dom/") ||
    pkgPath === "scheduler" ||
    pkgPath.startsWith("scheduler/")
  )
    return "react-vendor";
  if (pkgPath.startsWith("@tanstack/react-query")) return "query-vendor";
  if (pkgPath.startsWith("@dnd-kit/")) return "dnd-vendor";
  if (
    pkgPath.startsWith("@radix-ui/") ||
    pkgPath === "sonner" ||
    pkgPath.startsWith("sonner/") ||
    pkgPath === "tailwind-merge" ||
    pkgPath.startsWith("tailwind-merge/") ||
    pkgPath.startsWith("tailwindcss")
  )
    return "ui-vendor";
  // Let the bundler preserve optional dependency boundaries. A catch-all
  // vendor chunk pulls editor, docs and other route-only libraries into boot.
  return undefined;
}

