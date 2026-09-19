// Prepare verified, compressed objects for the existing OFFICE_RUNTIME R2 binding.
// This command only writes local files; it never deploys or uploads.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, "apps/admin/office-runtime.json"), "utf8"),
);
const cache = join(root, ".cache/office-runtime", manifest.build);
const target = join(cache, "upload");
await mkdir(target, { recursive: true });
const objects = [];
for (const [name, asset] of Object.entries(manifest.files)) {
  const bytes = await readFile(join(cache, name));
  if (
    bytes.length !== asset.size ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  )
    throw new Error("Unverified runtime asset: " + name);
  const compressed = brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
  });
  const path = join(target, name + ".br");
  await writeFile(path, compressed);
  objects.push({
    key: "office-runtime/" + manifest.build + "/" + name,
    file: path,
    contentType: asset.type,
    contentEncoding: "br",
    size: compressed.length,
  });
  console.log(name + ": " + compressed.length + " bytes compressed");
}
await writeFile(
  join(target, "objects.json"),
  JSON.stringify(objects, null, 2) + "\n",
);
console.log("Upload inventory: " + join(target, "objects.json"));
