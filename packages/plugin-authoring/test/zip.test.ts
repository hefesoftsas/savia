import { describe, expect, it } from "vitest";
import { encodeStoredZip, encodeStoredZipBlob } from "../src/zip";

function readFirstStoredEntry(zip: Uint8Array): {
  name: string;
  data: Uint8Array;
} {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(view.getUint16(8, true)).toBe(0);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const dataLength = view.getUint32(18, true);
  const nameStart = 30;
  const dataStart = nameStart + nameLength + extraLength;
  return {
    name: new TextDecoder().decode(
      zip.subarray(nameStart, nameStart + nameLength),
    ),
    data: zip.slice(dataStart, dataStart + dataLength),
  };
}

function readStoredZip(
  zip: Uint8Array,
): Array<{ name: string; data: Uint8Array }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const endOffset = zip.length - 22;
  expect(view.getUint32(endOffset, true)).toBe(0x06054b50);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  let cursor = centralOffset;

  for (let i = 0; i < entryCount; i += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    expect(view.getUint16(cursor + 10, true)).toBe(0);
    const crc = view.getUint32(cursor + 16, true);
    const dataLength = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(
      zip.subarray(cursor + 46, cursor + 46 + nameLength),
    );

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint32(localOffset + 14, true)).toBe(crc);
    expect(view.getUint32(localOffset + 18, true)).toBe(dataLength);
    expect(view.getUint32(localOffset + 22, true)).toBe(dataLength);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localNameStart = localOffset + 30;
    expect(
      new TextDecoder().decode(
        zip.subarray(localNameStart, localNameStart + localNameLength),
      ),
    ).toBe(name);
    const dataStart = localNameStart + localNameLength + localExtraLength;
    entries.push({ name, data: zip.slice(dataStart, dataStart + dataLength) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  expect(cursor).toBe(centralOffset + centralSize);
  expect(cursor).toBe(endOffset);
  return entries;
}

describe("encodeStoredZip", () => {
  it("round trips raw binary bytes without UTF-8 conversion", () => {
    const backing = new Uint8Array([0x99, 0x00, 0xff, 0x80, 0x41, 0x99]);
    const binary = backing.subarray(1, 5);
    const zip = encodeStoredZip([{ name: "assets/icon.bin", data: binary }]);

    expect(readFirstStoredEntry(zip)).toEqual({
      name: "assets/icon.bin",
      data: new Uint8Array([0x00, 0xff, 0x80, 0x41]),
    });
  });

  it("continues to encode string data as UTF-8", () => {
    const zip = encodeStoredZip([{ name: "entry.txt", data: "Savía 🚀" }]);

    expect(readFirstStoredEntry(zip)).toEqual({
      name: "entry.txt",
      data: new TextEncoder().encode("Savía 🚀"),
    });
  });

  it("streams async string and binary entries into a valid Blob ZIP", async () => {
    const binaryBacking = new Uint8Array([0xaa, 0x00, 0xff, 0x81, 0xbb]);
    const binary = binaryBacking.subarray(1, 4);
    const consumed: string[] = [];
    async function* entries() {
      consumed.push("assets/image.bin");
      yield { name: "assets/image.bin", data: binary };
      consumed.push("docs/naïve.txt");
      yield { name: "docs/naïve.txt", data: "Savía 🚀" };
      consumed.push("empty.bin");
      yield { name: "empty.bin", data: new Uint8Array() };
    }

    const zip = await encodeStoredZipBlob(entries());
    expect(zip).toBeInstanceOf(Blob);
    expect(consumed).toEqual([
      "assets/image.bin",
      "docs/naïve.txt",
      "empty.bin",
    ]);
    expect(readStoredZip(new Uint8Array(await zip.arrayBuffer()))).toEqual([
      { name: "assets/image.bin", data: new Uint8Array([0x00, 0xff, 0x81]) },
      { name: "docs/naïve.txt", data: new TextEncoder().encode("Savía 🚀") },
      { name: "empty.bin", data: new Uint8Array() },
    ]);
  });
});
