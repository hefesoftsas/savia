import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
/** Ship only declaration text from the same pinned workspace dependencies. */
export async function buildDeclarations(repo, ambient) {
  const admin = createRequire(join(repo, "apps/admin/package.json"));
  const pdf = createRequire(
    join(repo, "packages/insurance-quotes/package.json"),
  );
  const reactTypes = createRequire(admin.resolve("@types/react/package.json"));
  const packages = {
    react: admin.resolve("@types/react/package.json"),
    "react-dom": admin.resolve("@types/react-dom/package.json"),
    csstype: reactTypes.resolve("csstype/package.json"),
    zod: admin.resolve("zod/package.json"),
    "pdf-lib": pdf.resolve("pdf-lib/package.json"),
  };
  const result = { "plugin.d.ts": ambient };
  const licenses = {};
  for (const [name, manifest] of Object.entries(packages)) {
    const root = dirname(manifest);
    async function walk(directory, relative = "") {
      for (const entry of await fs.readdir(directory, {
        withFileTypes: true,
      })) {
        if (entry.name === "node_modules" || entry.isSymbolicLink()) continue;
        const path = relative + entry.name;
        if (entry.isDirectory())
          await walk(join(directory, entry.name), path + "/");
        else if (/\.d\.(?:ts|cts|mts)$/.test(path))
          result[name + "/" + path] = await fs.readFile(
            join(directory, entry.name),
            "utf8",
          );
      }
    }
    await walk(root);
    for (const filename of [
      "LICENSE",
      "LICENSE.md",
      "LICENSE.txt",
      "License.txt",
    ]) {
      try {
        licenses[name] = await fs.readFile(join(root, filename), "utf8");
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return { files: result, licenses };
}
