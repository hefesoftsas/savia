import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect, vi } from "vitest";
import { readProjectFile } from "../src/filesystem";
it("rejects a parent substitution restored before validation without returning outside bytes", async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), "savia-parent-race-"));
  const root = join(folder, "project"),
    outside = join(folder, "outside");
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.mkdir(join(root, "source"));
  await fs.writeFile(join(root, "source/file.ts"), "owned");
  await fs.writeFile(join(outside, "file.ts"), "outside secret");
  const open = fs.open.bind(fs);
  const spy = vi.spyOn(fs, "open").mockImplementation(async (path, ...args) => {
    if (String(path) === join(root, "source/file.ts")) {
      await fs.rename(join(root, "source"), join(root, "saved"));
      await fs.symlink(outside, join(root, "source"), "dir");
      const handle = await open(path, ...args);
      await fs.unlink(join(root, "source"));
      await fs.rename(join(root, "saved"), join(root, "source"));
      return handle;
    }
    return open(path, ...args);
  });
  try {
    await expect(readProjectFile(root, "source/file.ts", 1024)).rejects.toThrow(
      "changed",
    );
  } finally {
    spy.mockRestore();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
