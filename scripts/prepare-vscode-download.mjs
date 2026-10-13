import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { prepareVscodeDownload } from "./lib/prepare-vscode-download.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { filename } = await prepareVscodeDownload({
  manifestPath: join(repo, "apps/vscode/extension/package.json"),
  artifactsDir: join(repo, "apps/vscode/artifacts"),
  downloadsDir: join(repo, "apps/admin/public/downloads"),
});
console.log(`Prepared /downloads/${filename} for the admin asset build.`);
