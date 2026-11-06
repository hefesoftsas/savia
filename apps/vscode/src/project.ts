import fs from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { localPluginDescriptorSchema } from "@savia/studio-shared/plugin-development";
import {
  pluginProjectFilesSchema,
  parsePluginOriginalSourceFiles,
  PLUGIN_PROJECT_MAX_BYTES,
  PLUGIN_ORIGINAL_SOURCE_MAX_BYTES,
} from "@savia/studio-shared/plugin-projects";
import { pluginStoreManifestSchema } from "@savia/studio-shared/plugin-store";
import type { ConnectionProfile } from "./client";
import { descriptorPath, baselinePath } from "./checkout";
import {
  resolveProjectRoot,
  readProjectFile,
  validateSourcePaths,
  type ProjectRoot,
} from "./filesystem";
export const baselineSchema = z
  .object({
    files: pluginProjectFilesSchema,
    generatedFiles: z.array(z.literal("tsconfig.json")).max(1),
  })
  .strict();
const decode = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const metadata = [
  "savia-extension.json",
  "store.json",
  "preview.json",
] as const;
export async function readProjectDescriptor(
  rootUri: ProjectRoot,
  profile: ConnectionProfile,
) {
  const { path: root } = await resolveProjectRoot(rootUri);
  const descriptor = localPluginDescriptorSchema.parse(
    JSON.parse(decode(await readProjectFile(root, descriptorPath, 16 * 1024))),
  );
  if (
    descriptor.origin !== profile.origin ||
    descriptor.tenantId !== profile.tenantId
  )
    throw new Error("The project does not match the selected connection.");
  return descriptor;
}
export async function readLocalProject(
  rootUri: ProjectRoot,
  profile: ConnectionProfile,
) {
  const { path: root } = await resolveProjectRoot(rootUri);
  const descriptor = await readProjectDescriptor(rootUri, profile);
  const baseline = baselineSchema.parse(
    JSON.parse(
      decode(
        await readProjectFile(
          root,
          baselinePath,
          PLUGIN_PROJECT_MAX_BYTES + 64 * 1024,
        ),
      ),
    ),
  );
  const files = { ...baseline.files };
  for (const path of metadata)
    files[path] = decode(await readProjectFile(root, path, 100 * 1024));
  const manifest = pluginStoreManifestSchema.parse(
    JSON.parse(files["savia-extension.json"]),
  );
  if (manifest.id !== descriptor.pluginId)
    throw new Error(
      "The local manifest does not match the selected plugin identity.",
    );
  if (!baseline.files["original-source.json"])
    files["entry.tsx"] = decode(
      await readProjectFile(root, "entry.tsx", 2 * 1024 * 1024),
    );
  else {
    const archive: Record<string, string> = {};
    const actualPaths: string[] = [];
    const original = parsePluginOriginalSourceFiles(
      baseline.files["original-source.json"],
    );
    const spelling = new Map(
      Object.keys(original).map((path) => [path.normalize("NFC"), path]),
    );
    async function visit(directory: string, prefix = "") {
      for (const entry of await fs.readdir(directory, {
        withFileTypes: true,
      })) {
        const path = prefix + entry.name;
        if (
          [".savia", ".git", ".vscode", "node_modules"].includes(
            entry.name.toLowerCase(),
          ) &&
          entry.isDirectory()
        )
          continue;
        if (!prefix && baseline.generatedFiles.some((file) => file === path))
          continue;
        if (
          !prefix &&
          (metadata as readonly string[]).includes(path) &&
          !Object.hasOwn(original, path)
        )
          continue;
        if (entry.isSymbolicLink())
          throw new Error("Project source contains a symlink.");
        if (entry.isDirectory()) {
          await visit(join(directory, entry.name), path + "/");
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|css|json|svg|png|webp)$/.test(path)) continue;
        if (actualPaths.length >= 256)
          throw new Error("Original source exceeds its file limit.");
        actualPaths.push(path);
        const content = await readProjectFile(
          root,
          path,
          PLUGIN_ORIGINAL_SOURCE_MAX_BYTES,
        );
        const sourcePath = spelling.get(path.normalize("NFC")) ?? path;
        archive[sourcePath] = /\.(png|webp)$/.test(path)
          ? `data:image/${path.endsWith(".png") ? "png" : "webp"};base64,${content.toString("base64")}`
          : new TextDecoder("utf-8", { fatal: true }).decode(content);
        if (
          new TextEncoder().encode(JSON.stringify(archive)).byteLength >
          PLUGIN_ORIGINAL_SOURCE_MAX_BYTES
        )
          throw new Error("Original source exceeds its 2 MB limit.");
      }
    }
    await visit(root);
    validateSourcePaths(actualPaths);
    validateSourcePaths(Object.keys(archive));
    files["original-source.json"] = JSON.stringify(
      parsePluginOriginalSourceFiles(JSON.stringify(archive)),
    );
  }
  pluginProjectFilesSchema.parse(files);
  if (
    new TextEncoder().encode(JSON.stringify(files)).byteLength >
    PLUGIN_PROJECT_MAX_BYTES
  )
    throw new Error("Project exceeds its 5 MB limit.");
  return { descriptor, files, baseline: baseline.files };
}
export async function selectProjectRoot<T extends ProjectRoot>(
  roots: readonly T[],
  choose: (roots: readonly T[]) => PromiseLike<T | undefined>,
): Promise<T | undefined> {
  if (!roots.length) return undefined;
  return roots.length === 1 ? roots[0] : await choose(roots);
}
