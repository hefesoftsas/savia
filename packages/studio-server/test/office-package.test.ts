import { readFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { validateOfficePackage } from "@savia/studio-shared/office";

function archive(
  content: Buffer,
  declaredSize = content.length,
  descriptor = false,
) {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, raw] of [
    ["[Content_Types].xml", Buffer.from("<Types/>")],
    ["word/document.xml", content],
  ] as const) {
    const filename = Buffer.from(name),
      compressed = deflateRawSync(raw),
      checksum = crc32(raw);
    const size = name === "word/document.xml" ? declaredSize : raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(descriptor ? 8 : 0, 6);
    local.writeUInt16LE(8, 8);
    if (!descriptor) {
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(size, 22);
    }
    local.writeUInt16LE(filename.length, 26);
    const trailer = Buffer.alloc(descriptor ? 16 : 0);
    if (descriptor) {
      trailer.writeUInt32LE(0x08074b50);
      trailer.writeUInt32LE(checksum, 4);
      trailer.writeUInt32LE(compressed.length, 8);
      trailer.writeUInt32LE(size, 12);
    }
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(descriptor ? 8 : 0, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(size, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    locals.push(local, filename, compressed, trailer);
    central.push(directory, filename);
    offset +=
      local.length + filename.length + compressed.length + trailer.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(2, 8);
  end.writeUInt16LE(2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe("Office ZIP validation", () => {
  it("accepts the real DOCX fixture and streaming ZIP data descriptors", async () => {
    await validateOfficePackage(
      new Uint8Array(
        readFileSync(new URL("./fixtures/office.docx", import.meta.url)),
      ),
      "docx",
    );
    await validateOfficePackage(
      archive(Buffer.from("<document/>"), 11, true),
      "docx",
    );
  });

  it("rejects forged expansion sizes even when both headers agree", async () => {
    await expect(
      Promise.resolve().then(() =>
        validateOfficePackage(archive(Buffer.alloc(1024 * 1024), 1), "docx"),
      ),
    ).rejects.toThrow();
  });

  it("rejects local header encryption inconsistent with the directory", async () => {
    const bytes = archive(Buffer.from("<document/>"));
    bytes.writeUInt16LE(1, 6);
    await expect(
      Promise.resolve().then(() => validateOfficePackage(bytes, "docx")),
    ).rejects.toThrow();
  });

  it("rejects archives whose aggregate expansion exceeds 64 MiB", async () => {
    await expect(
      Promise.resolve().then(() =>
        validateOfficePackage(
          archive(Buffer.alloc(64 * 1024 * 1024), 64 * 1024 * 1024),
          "docx",
        ),
      ),
    ).rejects.toThrow();
  });

  it("rejects corrupted deflate content with intact ZIP headers", async () => {
    const bytes = archive(Buffer.from("<document/>"));
    bytes[30 + "[Content_Types].xml".length] = 0xff;
    await expect(
      Promise.resolve().then(() => validateOfficePackage(bytes, "docx")),
    ).rejects.toThrow();
  });
});
