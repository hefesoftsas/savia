import { build } from "esbuild";
import type { Plugin } from "vite";
import { fileURLToPath } from "node:url";

/** Both the browser editor and native VSIX ship these same pinned bundles. */
export async function buildPluginIdeRuntime(): Promise<string> {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL(
          "../src/features/studio-engine/plugin-ide-react-runtime.ts",
          import.meta.url,
        ),
      ),
    ],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "SaviaPluginReact",
    platform: "browser",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  return result.outputFiles[0].text;
}
export async function buildPluginIdeVendorBundles(): Promise<
  Record<string, string>
> {
  return Object.fromEntries(
    await Promise.all(
      (
        [
          ["zod", "SaviaPluginZod", new URL("../", import.meta.url)],
          [
            "pdf-lib",
            "SaviaPluginPdf",
            new URL("../../../packages/insurance-quotes/", import.meta.url),
          ],
        ] as const
      ).map(async ([name, globalName, directory]) => {
        const result = await build({
          stdin: {
            contents: `export * from "${name}";`,
            resolveDir: fileURLToPath(directory),
            sourcefile: "plugin-vendor.js",
          },
          bundle: true,
          write: false,
          format: "iife",
          globalName,
          platform: "browser",
          minify: true,
          define: { "process.env.NODE_ENV": '"production"' },
        });
        return [name, result.outputFiles[0].text];
      }),
    ),
  );
}
export async function buildPluginIdeBundles() {
  const [runtimeBundle, vendorBundles] = await Promise.all([
    buildPluginIdeRuntime(),
    buildPluginIdeVendorBundles(),
  ]);
  return { runtimeBundle, vendorBundles };
}
export function pluginIdeRuntimePlugin(): Plugin {
  let bundled: Promise<string> | undefined;
  let vendors: Promise<Record<string, string>> | undefined;
  return {
    name: "savia-plugin-ide-runtime",
    resolveId(id) {
      if (
        [
          "virtual:savia-plugin-ide-runtime",
          "virtual:savia-plugin-ide-vendors",
        ].includes(id)
      )
        return `\0${id}`;
    },
    async load(id) {
      if (id === "\0virtual:savia-plugin-ide-vendors") {
        vendors ??= buildPluginIdeVendorBundles();
        return `export default ${JSON.stringify(await vendors)}`;
      }
      if (id === "\0virtual:savia-plugin-ide-runtime") {
        bundled ??= buildPluginIdeRuntime();
        return `export default ${JSON.stringify(await bundled)}`;
      }
    },
  };
}
