import { describe, expect, it } from "vitest";
import { encodeStoredZip } from "../src/zip";

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
});
