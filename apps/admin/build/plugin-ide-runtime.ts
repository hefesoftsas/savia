import { build } from "esbuild";
import type { Plugin } from "vite";
import { fileURLToPath } from "node:url";

/** Builds the React runtime used by the plugin IDE's self-contained artifact. */
export function pluginIdeRuntimePlugin(): Plugin {
  let bundled: Promise<string> | undefined;
  return {
    name: "savia-plugin-ide-runtime",
    resolveId(id) {
      if (id === "virtual:savia-plugin-ide-runtime") return `\0${id}`;
    },
    async load(id) {
      if (id !== "\0virtual:savia-plugin-ide-runtime") return;
      bundled ??= build({
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
      }).then((result) => result.outputFiles[0].text);
      return `export default ${JSON.stringify(await bundled)}`;
    },
  };
}
