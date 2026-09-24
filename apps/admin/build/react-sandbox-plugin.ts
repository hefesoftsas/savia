import { build } from "esbuild";
import type { Plugin } from "vite";
import { fileURLToPath } from "node:url";
export function reactSandboxPlugin(): Plugin {
  let bundled: Promise<string> | undefined;
  return {
    name: "savia-react-sandbox",
    resolveId(id) {
      if (id === "virtual:savia-react-runtime") return "\0" + id;
    },
    async load(id) {
      if (id !== "\0virtual:savia-react-runtime") return;
      bundled ??= build({
        entryPoints: [
          fileURLToPath(
            new URL(
              "../src/features/studio-engine/result-react-runtime.ts",
              import.meta.url,
            ),
          ),
        ],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        minify: true,
        define: { "process.env.NODE_ENV": '"production"' },
      }).then((result) => result.outputFiles[0].text);
      return `export default ${JSON.stringify(await bundled)}`;
    },
  };
}
