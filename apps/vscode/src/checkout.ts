import fs from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import {
  pluginCheckoutSchema,
  localPluginDescriptorSchema,
  type PluginCheckout,
  type LocalPluginDescriptor,
} from "@savia/studio-shared/plugin-development";
import { parsePluginOriginalSourceFiles } from "@savia/studio-shared/plugin-projects";
import type { ConnectionProfile } from "./client";
import {
  resolveProjectRoot,
  validateSourcePaths,
  writeStagedFile,
  type ProjectRoot,
} from "./filesystem";
import { nativeDeclarationFiles, projectTypeConfig } from "./declarations";

export const descriptorPath = ".savia/plugin.json";
export const baselinePath = ".savia/baseline.json";
export function decodeSourceAsset(
  path: string,
  text: string,
): string | Uint8Array {
  if (!/\.(png|webp)$/.test(path)) return text;
  const format = path.endsWith(".png") ? "png" : "webp";
  const match = new RegExp(
    `^data:image/${format};base64,([A-Za-z0-9+/]+={0,2})$`,
  ).exec(text);
  if (!match) throw new Error("Original image asset has an invalid data URI.");
  const bytes = Buffer.from(match[1], "base64");
  if (
    bytes.toString("base64").replace(/=+$/, "") !== match[1].replace(/=+$/, "")
  )
    throw new Error("Original image asset has invalid base64.");
  return bytes;
}
export async function checkoutProject(
  rootUri: ProjectRoot,
  request: PluginCheckout,
  profile: ConnectionProfile,
  declarations = nativeDeclarationFiles,
): Promise<LocalPluginDescriptor> {
  const checkout = pluginCheckoutSchema.parse(request);
  if (checkout.authoringKind !== "authored")
    throw new Error(
      "This compiled-only plugin cannot be checked out for editing.",
    );
  const root = await resolveProjectRoot(rootUri);
  if ((await fs.readdir(root.path)).length)
    throw new Error("Checkout requires an empty folder.");
  const archive = checkout.files["original-source.json"]
    ? parsePluginOriginalSourceFiles(checkout.files["original-source.json"])
    : null;
  const files: Record<string, string> = {
    ...(archive ?? { "entry.tsx": checkout.files["entry.tsx"] }),
  };
  for (const path of [
    "savia-extension.json",
    "store.json",
    "preview.json",
  ] as const) {
    if (Object.hasOwn(files, path) && files[path] !== checkout.files[path])
      throw new Error(
        "Original source conflicts with reserved project metadata.",
      );
    files[path] = checkout.files[path];
  }
  validateSourcePaths(Object.keys(files));
  if (!Object.hasOwn(files, checkout.entryPath))
    throw new Error("The selected authored entry is unavailable.");
  const descriptor = localPluginDescriptorSchema.parse({
    schemaVersion: 1,
    origin: profile.origin,
    tenantId: profile.tenantId,
    pluginId: checkout.pluginId,
    sourceVersion: checkout.sourceVersion,
    sourceSha256: checkout.sourceSha256,
    expectedHead: checkout.head,
    entryPath: checkout.entryPath,
  });
  const generatedFiles: string[] = [];
  if (!Object.hasOwn(files, "tsconfig.json")) {
    files["tsconfig.json"] = projectTypeConfig(Object.keys(files));
    generatedFiles.push("tsconfig.json");
  }
  validateSourcePaths(Object.keys(files));
  const parent = dirname(root.path);
  const parentStat = await fs.stat(parent);
  const stage = await fs.mkdtemp(
    join(parent, `.${basename(root.path)}-savia-checkout-`),
  );
  await fs.chmod(stage, 0o700);
  let committed = false;
  let removed = false;
  try {
    for (const [path, text] of Object.entries(files))
      await writeStagedFile(stage, path, decodeSourceAsset(path, text));
    for (const [path, text] of Object.entries(declarations)) {
      validateSourcePaths([path]);
      await writeStagedFile(stage, `.savia/types/${path}`, text);
    }
    await writeStagedFile(
      stage,
      baselinePath,
      JSON.stringify({ files: checkout.files, generatedFiles }, null, 2) + "\n",
    );
    // The descriptor is the validity marker and is written last.
    await writeStagedFile(
      stage,
      descriptorPath,
      JSON.stringify(descriptor, null, 2) + "\n",
    );
    const current = await fs.lstat(root.path);
    const currentParent = await fs.stat(parent);
    if (
      current.isSymbolicLink() ||
      current.ino !== root.stat.ino ||
      current.dev !== root.stat.dev ||
      currentParent.ino !== parentStat.ino ||
      currentParent.dev !== parentStat.dev ||
      (await fs.readdir(root.path)).length
    )
      throw new Error("The checkout folder changed while staging files.");
    await fs.rmdir(root.path);
    removed = true;
    await fs.rename(stage, root.path);
    committed = true;
    return descriptor;
  } finally {
    if (!committed) {
      await fs.rm(stage, { recursive: true, force: true });
      if (removed) {
        const parentNow = await fs.stat(parent);
        if (
          parentNow.ino === parentStat.ino &&
          parentNow.dev === parentStat.dev
        )
          await fs
            .mkdir(root.path, { mode: 0o700 })
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "EEXIST") throw error;
            });
      }
    }
  }
}
