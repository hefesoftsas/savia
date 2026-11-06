import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  readFile,
  writeFile,
  stat,
  access,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encryptBackup } from "./encrypt-flows-backup.mjs";
test("streaming encryption round trips a private archive and rejects tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "flows-encryption-"));
  try {
    const input = join(root, "input"),
      enc = join(root, "enc"),
      out = join(root, "out");
    const data = Buffer.alloc(1024 * 1024, 42),
      key = "12".repeat(32);
    await writeFile(input, data);
    await encryptBackup(input, enc, key);
    assert.equal((await stat(enc)).mode & 0o777, 0o600);
    assert.equal((await stat(enc)).size, data.length + 36);
    await encryptBackup(enc, out, key, true);
    assert.deepEqual(await readFile(out), data);
    const corrupt = await readFile(enc);
    corrupt[30] ^= 1;
    await writeFile(join(root, "corrupt"), corrupt);
    await assert.rejects(
      encryptBackup(join(root, "corrupt"), join(root, "failed"), key, true),
    );
    await assert.rejects(access(join(root, "failed")));
    await assert.rejects(
      encryptBackup(enc, join(root, "wrong-key"), "34".repeat(32), true),
    );
    await assert.rejects(encryptBackup(input, enc, key), /exist/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
