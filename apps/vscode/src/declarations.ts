import { pluginIdeDeclarations } from "../../admin/src/features/studio-engine/plugin-ide-declarations";
/** The browser and native editor share the runtime's ambient declarations. */
export const nativeDeclarationFiles: Record<string, string> = {
  "plugin.d.ts": pluginIdeDeclarations,
};
export function projectTypeConfig(paths: string[]) {
  const aliases: Record<string, string[]> = {
    react: [".savia/types/react/index.d.ts"],
    "react/*": [".savia/types/react/*"],
    "react-dom/*": [".savia/types/react-dom/*"],
    zod: [".savia/types/zod/index.d.ts"],
    "zod/*": [".savia/types/zod/*"],
    "pdf-lib": [".savia/types/pdf-lib/es/index.d.ts"],
    csstype: [".savia/types/csstype/index.d.ts"],
  };
  for (const path of paths) {
    const module = /^packages\/([^/]+)\/src\//.exec(path)?.[1];
    if (module) {
      aliases[`@savia/${module}`] = [`packages/${module}/src/index.ts`];
      aliases[`@savia/${module}/*`] = [`packages/${module}/src/*`];
    }
  }
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM"],
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react",
          allowJs: true,
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          baseUrl: ".",
          paths: aliases,
        },
        include: [
          "**/*.ts",
          "**/*.tsx",
          "**/*.js",
          "**/*.jsx",
          ".savia/types/**/*.d.ts",
        ],
        exclude: ["node_modules", ".git", ".savia/artifacts"],
      },
      null,
      2,
    ) + "\n"
  );
}
