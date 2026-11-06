import fs from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  assertNoSymlinks,
  readProjectFile,
  resolveProjectRoot,
  type ProjectRoot,
} from "./filesystem";
export async function writeMetadata(
  rootUri: ProjectRoot,
  path: string,
  bytes: string | Uint8Array,
  immutable = false,
) {
  if (
    !/^\.savia\/(?:artifacts\/[a-f0-9]{64}\.zip|receipts\/[a-f0-9]{64}\.json|plugin\.json|baseline\.json)$/.test(
      path,
    )
  )
    throw new Error("Invalid authoring metadata path.");
  const { path: root } = await resolveProjectRoot(rootUri);
  const target = await assertNoSymlinks(root, path);
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await assertNoSymlinks(root, path);
  if (immutable) {
    try {
      await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readProjectFile(root, path, 6 * 1024 * 1024);
      const expected = createHash("sha256").update(bytes).digest("hex");
      if (createHash("sha256").update(existing).digest("hex") !== expected)
        throw new Error("The retained artifact has a different digest.");
    }
    await assertNoSymlinks(root, path);
    return;
  }
  const temporary = path + "." + randomUUID() + ".tmp";
  const temp = await assertNoSymlinks(root, temporary);
  try {
    await fs.writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
    await assertNoSymlinks(root, path);
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
