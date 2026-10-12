import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const app = dirname(dirname(fileURLToPath(import.meta.url)));
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : resolve(process.argv[index + 1]);
};
const stage = argument("--stage", join(app, ".staging"));
const manifest = JSON.parse(
  await fs.readFile(join(stage, "package.json"), "utf8"),
);
if (
  manifest.name !== "savia-plugin-authoring" ||
  manifest.publisher !== "savia" ||
  manifest.main !== "./dist/extension.cjs" ||
  manifest.engines.vscode !== "^1.96.2"
)
  throw new Error("Invalid standalone VSIX manifest.");
for (const path of [
  "assets/bundles.json",
  "assets/declarations.json",
  "assets/type-licenses.json",
  "dist/extension.cjs",
  "types/plugin.d.ts",
  "README.md",
  "LICENSE",
]) {
  if (!(await fs.stat(join(stage, path))).isFile())
    throw new Error("Required VSIX assets are unavailable.");
}
const bundles = JSON.parse(
  await fs.readFile(join(stage, "assets/bundles.json"), "utf8"),
);
if (
  !bundles.runtimeBundle ||
  !bundles.vendorBundles?.zod ||
  !bundles.vendorBundles?.["pdf-lib"]
)
  throw new Error("Pinned runtime assets are unavailable.");
async function inspect(directory, relative = "") {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const path = relative + entry.name;
    if (entry.isSymbolicLink())
      throw new Error("VSIX staging must not contain symlinks.");
    if (
      /(?:^|\/)(?:node_modules|test|\.savia|secrets|\.env(?:\.|$))/.test(path)
    )
      throw new Error("VSIX staging contains an excluded path.");
    if (entry.isDirectory())
      await inspect(join(directory, entry.name), path + "/");
  }
}
await inspect(stage);
const output = argument(
  "--out",
  join(app, `artifacts/savia-plugin-authoring-${manifest.version}.vsix`),
);
await fs.mkdir(dirname(output), { recursive: true });
const require = createRequire(import.meta.url);
const cli = require.resolve("@vscode/vsce/vsce");
execFileSync(
  process.execPath,
  [
    cli,
    "package",
    "--no-dependencies",
    "--out",
    output,
    "--no-rewrite-relative-links",
  ],
  {
    cwd: stage,
    stdio: "inherit",
    env: { ...process.env, VSCE_TELEMETRY_DISABLED: "1" },
  },
);
const bytes = await fs.readFile(output);
const sha256 = createHash("sha256").update(bytes).digest("hex");
await fs.writeFile(
  output + ".sha256",
  `${sha256} ${output.split(/[\\/]/).pop()}\n`,
);
console.log(`VSIX SHA-256: ${sha256}`);
