import fs from "node:fs/promises";
import { constants } from "node:fs";
import {
  resolve,
  join,
  relative,
  isAbsolute,
  sep,
  dirname,
  parse as parsePath,
} from "node:path";
import { pluginDevelopmentPathSchema } from "@savia/studio-shared/plugin-development";
export type ProjectRoot = { scheme: string; fsPath: string };
export function validateSourcePaths(paths: string[]) {
  const seen = new Map<string, string>();
  for (const path of paths) {
    if (
      path
        .split("/")
        .some((part) =>
          [".savia", ".git", ".vscode", "node_modules"].includes(
            part.toLowerCase(),
          ),
        )
    )
      throw new Error("Reserved repository or editor configuration path.");
    pluginDevelopmentPathSchema.parse(path);
    const segments = path.split("/");
    for (const segment of segments)
      if (
        /[. ]$/.test(segment) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
      )
        throw new Error("Reserved source path.");
    for (let end = 1; end <= segments.length; end++) {
      const prefix = segments.slice(0, end).join("/");
      const normalized = prefix.normalize("NFC").toLowerCase();
      const previous = seen.get(normalized);
      if (previous !== undefined && previous !== prefix)
        throw new Error(`Source path collision: ${prefix}.`);
      seen.set(normalized, prefix);
    }
  }
}
export async function resolveProjectRoot(uri: ProjectRoot) {
  if (
    !["file", "vscode-remote"].includes(uri.scheme) ||
    !isAbsolute(uri.fsPath)
  )
    throw new Error("Select a filesystem project folder.");
  const path = resolve(uri.fsPath);
  const volume = parsePath(path).root;
  let ancestor = volume;
  for (const segment of path.slice(volume.length).split(sep).filter(Boolean)) {
    ancestor = join(ancestor, segment);
    if ((await fs.lstat(ancestor)).isSymbolicLink()) {
      const aliases: Record<string, string> = {
        "/var": "/private/var",
        "/tmp": "/private/tmp",
      };
      const systemAlias =
        process.platform === "darwin" &&
        aliases[ancestor] &&
        (await fs.realpath(ancestor)) === aliases[ancestor];
      if (!systemAlias)
        throw new Error("Project folder ancestors must not contain a symlink.");
    }
  }
  const stat = await fs.lstat(path);
  if (stat.isSymbolicLink())
    throw new Error("Project root must not be a symlink.");
  if (!stat.isDirectory()) throw new Error("Project root must be a directory.");
  return { path: await fs.realpath(path), stat };
}
export function containedPath(root: string, path: string) {
  const destination = resolve(root, ...path.split("/"));
  const part = relative(root, destination);
  if (!part || part === ".." || part.startsWith(".." + sep) || isAbsolute(part))
    throw new Error("Source path escapes the project root.");
  return destination;
}
export async function assertNoSymlinks(root: string, path: string) {
  const target = containedPath(root, path);
  let current = root;
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error("Project root contains a symlink.");
  for (const part of relative(root, target).split(sep)) {
    current = join(current, part);
    const stat = await fs
      .lstat(current)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
    if (stat?.isSymbolicLink())
      throw new Error("Project source contains a symlink.");
    if (!stat) break;
  }
  return target;
}
export async function readProjectFile(
  root: string,
  path: string,
  maxBytes: number,
): Promise<Buffer> {
  const target = await assertNoSymlinks(root, path);
  const handle = await fs.open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error("Project file exceeds its byte limit.");
    const chunks: Buffer[] = [];
    let length = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - length + 1));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > maxBytes)
        throw new Error("Project file exceeds its byte limit.");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const bytes = Buffer.concat(chunks, length);
    await assertNoSymlinks(root, path);
    return bytes;
  } finally {
    await handle.close();
  }
}
/** Call only in an operation-owned, mode-0700 staging directory. */
export async function writeStagedFile(
  root: string,
  path: string,
  bytes: string | Uint8Array,
) {
  const target = containedPath(root, path);
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await assertNoSymlinks(root, path);
  await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  await assertNoSymlinks(root, path);
}
