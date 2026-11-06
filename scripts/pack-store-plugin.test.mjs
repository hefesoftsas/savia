import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packageStorePlugin } from "./pack-store-plugin.mjs";

function centralDirectoryTimestamps(zip) {
  const entries = [];
  let endOffset = zip.length - 22;
  while (endOffset >= 0 && zip.readUInt32LE(endOffset) !== 0x06054b50)
    endOffset -= 1;
  assert.ok(endOffset >= 0, "ZIP end-of-central-directory record exists");
  const count = zip.readUInt16LE(endOffset + 10);
  let offset = zip.readUInt32LE(endOffset + 16);
  for (let index = 0; index < count; index += 1) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    entries.push({
      time: zip.readUInt16LE(offset + 12),
      date: zip.readUInt16LE(offset + 14),
    });
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("store plugin archives have fixed ZIP timestamps and repeatable digests", async () => {
  const directory = mkdtempSync(join(tmpdir(), "savia-pack-store-test-"));
  try {
    const first = packageStorePlugin({
      portDir: "store-ports/http-echo",
      outputPath: join(directory, "first.zip"),
    });
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const second = packageStorePlugin({
      portDir: "store-ports/http-echo",
      outputPath: join(directory, "second.zip"),
    });

    assert.equal(first.sha256, second.sha256);
    const zip = readFileSync(first.artifactPath);
    const entries = centralDirectoryTimestamps(zip);
    assert.ok(entries.length >= 3);
    assert.deepEqual(
      entries,
      entries.map(() => ({ time: 0, date: 0x21 })),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
