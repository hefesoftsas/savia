import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { buildPluginIdeBundles } from "../../admin/build/plugin-ide-runtime.ts";
import { pluginIdeDeclarations } from "../../admin/src/features/studio-engine/plugin-ide-declarations.ts";
const app = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = resolve(app, "../..");
const index = process.argv.indexOf("--stage");
const stage =
  index >= 0 ? resolve(process.argv[index + 1]) : join(app, ".staging");
await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(join(stage, "dist"), { recursive: true });
await fs.cp(join(app, "extension"), stage, { recursive: true });
await fs.copyFile(join(repo, "LICENSE"), join(stage, "LICENSE"));
await fs.copyFile(
  join(repo, "docs/guides/vscode-plugin-development.md"),
  join(stage, "README.md"),
);
await build({
  entryPoints: [join(app, "src/extension.ts")],
  outfile: join(stage, "dist/extension.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  minify: true,
  legalComments: "eof",
  sourcemap: false,
});
await fs.mkdir(join(stage, "assets"), { recursive: true });
await fs.writeFile(
  join(stage, "assets/bundles.json"),
  JSON.stringify(await buildPluginIdeBundles()),
);
await fs.mkdir(join(stage, "types"), { recursive: true });
await fs.writeFile(join(stage, "types/plugin.d.ts"), pluginIdeDeclarations);
await fs.writeFile(join(stage, ".vscodeignore"), ".vscodeignore\n");
console.log(`Built native extension in ${stage}`);
