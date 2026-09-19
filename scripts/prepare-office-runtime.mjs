import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, "apps/admin/office-runtime.json"), "utf8"),
);
const target = join(root, ".cache/office-runtime", manifest.build);
await mkdir(target, { recursive: true });
const from = process.argv.indexOf("--from");
for (const [name, asset] of Object.entries(manifest.files)) {
  const path = join(target, name);
  let bytes;
  try {
    const cached = await readFile(path);
    if (createHash("sha256").update(cached).digest("hex") === asset.sha256) {
      console.log("Verified " + name);
      continue;
    }
  } catch {}
  if (from >= 0)
    bytes = await readFile(
      join(
        process.argv[from + 1],
        name === "zeta.js" ? "assets/vendor/zetajs/zeta.js" : name,
      ),
    );
  else {
    const response = await fetch(asset.source ?? manifest.source + name, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error("Download failed: " + name + " " + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (
    bytes.length !== asset.size ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  )
    throw new Error(
      "Runtime checksum mismatch: " +
        name +
        ". The upstream alias changed; review a new manifest before upgrading.",
    );
  await writeFile(path, bytes);
  console.log("Verified " + name);
}
console.log("Runtime prepared at " + target);
