export function saviaManualChunk(id: string): string | undefined {
  // Shared by optional catalogs and eager brand icons. Keep this factory out
  // of the extension host when manual chunks collect transitive dependencies.
  if (id.endsWith("/compact-brand-icon.ts")) return "icons";
  // Keep Vite's shared dynamic-import helper out of the optional host.
  if (id.includes("vite/preload-helper")) return "modulepreload-polyfill";
  if (!id.includes("node_modules")) return undefined;
  // The extension host lives in a separate document. Do not pull its
  // services into the shared app vendor chunk or offline shell.
  if (
    id.includes("@codingame") ||
    id.includes("@vscode") ||
    id.includes("prettier") ||
    id.includes("vscode-oniguruma") ||
    id.includes("vscode-textmate")
  )
    return "plugin-editor-vendor";
  const sep = String.raw`[/\\]`;
  if (new RegExp(`lucide-react${sep}dist${sep}esm${sep}icons${sep}`).test(id))
    return undefined;
  if (new RegExp(`@thesvg${sep}react${sep}dist${sep}`).test(id))
    return undefined;
  if (
    id.includes("lucide-react") ||
    id.includes("@thesvg") ||
    id.includes("lucide")
  )
    return "icons";
  if (
    id.includes("react-router") ||
    id.includes("react-dom") ||
    id.includes("/react/") ||
    id.endsWith("/react")
  )
    return "react-vendor";
  if (id.includes("@tanstack/react-query")) return "query-vendor";
  if (id.includes("@dnd-kit")) return "dnd-vendor";
  if (
    id.includes("@radix-ui") ||
    id.includes("sonner") ||
    id.includes("tailwind")
  )
    return "ui-vendor";
  // Let the bundler preserve optional dependency boundaries. A catch-all
  // vendor chunk pulls editor, docs and other route-only libraries into boot.
  return undefined;
}
