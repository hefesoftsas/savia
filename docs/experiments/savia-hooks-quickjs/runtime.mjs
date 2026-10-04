import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

export const directory = dirname(fileURLToPath(import.meta.url));
const requestRequire = createRequire(
  join(directory, "../../../apps/savia-request/package.json"),
);
const wranglerRequire = createRequire(
  requestRequire.resolve("wrangler/package.json"),
);
const selfRequire = createRequire(
  join(directory, "../../../apps/self-hosted/package.json"),
);
const quickRequire = createRequire(
  selfRequire.resolve("quickjs-emscripten/package.json"),
);
const { build } = wranglerRequire("esbuild");
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } =
  wranglerRequire("miniflare");

export async function compile() {
  const out = join(directory, ".build");
  await mkdir(out, { recursive: true });
  const sizes = {};
  for (const [name, entry] of [
    ["quickjs", "worker.ts"],
    ["dynamic", "dynamic-worker.ts"],
  ]) {
    await build({
      entryPoints: [join(directory, entry)],
      outfile: join(out, `${name}.mjs`),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      conditions: ["workerd"],
      minify: true,
      external: ["./quickjs.wasm"],
      alias: {
        "@jitl/quickjs-wasmfile-release-sync/emscripten-module": join(
          dirname(
            quickRequire.resolve(
              "@jitl/quickjs-wasmfile-release-sync/package.json",
            ),
          ),
          "dist/emscripten-module.cloudflare.cjs",
        ),
        "quickjs-emscripten-core": dirname(
          dirname(quickRequire.resolve("quickjs-emscripten-core")),
        ),
        "@jitl/quickjs-wasmfile-release-sync": dirname(
          quickRequire.resolve(
            "@jitl/quickjs-wasmfile-release-sync/package.json",
          ),
        ),
      },
    });
    const bytes = await readFile(join(out, `${name}.mjs`));
    sizes[name] = {
      jsBytes: bytes.length,
      jsGzipBytes: gzipSync(bytes).length,
    };
  }
  const wasm = await readFile(
    quickRequire.resolve("@jitl/quickjs-wasmfile-release-sync/wasm"),
  );
  await writeFile(join(out, "quickjs.wasm"), wasm);
  sizes.quickjs.wasmBytes = wasm.length;
  sizes.quickjs.wasmGzipBytes = gzipSync(wasm).length;
  return sizes;
}

export async function start(engine) {
  const out = join(directory, ".build");
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: `hook-probe-${engine}`,
      compatibilityDate: "2026-09-04",
      modules: [
        { type: "ESModule", path: join(out, `${engine}.mjs`) },
        ...(engine === "quickjs"
          ? [{ type: "CompiledWasm", path: join(out, "quickjs.wasm") }]
          : []),
      ],
      ...(engine === "dynamic" ? { workerLoaders: { LOADER: {} } } : {}),
      log: new Log(LogLevel.ERROR),
      // No application credentials, D1, outbound services, or unsafe eval binding.
    }),
  );
  await mf.ready;
  return mf;
}

export async function call(mf, fixture, repeat = 1) {
  const response = await mf.dispatchFetch("https://probe.local/", {
    method: "POST",
    body: JSON.stringify({ ...fixture, repeat }),
  });
  return response.json();
}
