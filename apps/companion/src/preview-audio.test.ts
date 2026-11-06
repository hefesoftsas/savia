import { describe, expect, it } from "vitest";
import { loadPreviewAudio } from "./preview-audio";

import { opus440Base64, opus880Base64 } from "./preview-audio.test-fixtures";

function decode(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let offset = start; offset < end; offset++) {
    const value =
      offset >= start + 22 && offset < start + 26 ? 0 : bytes[offset];
    crc ^= value << 24;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  return crc >>> 0;
}

// Normalize the fixture serials to the fixed serial emitted by Companion's
// encoder, keeping both inputs valid Ogg files with restarted sequence numbers.
function useCompanionSerial(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const result = bytes.slice();
  const view = new DataView(result.buffer);
  let offset = 0;
  while (offset < result.length) {
    const lacingCount = result[offset + 26];
    const headerEnd = offset + 27 + lacingCount;
    const bodyBytes = result
      .subarray(offset + 27, headerEnd)
      .reduce((sum, value) => sum + value, 0);
    const pageEnd = headerEnd + bodyBytes;
    view.setUint32(offset + 14, 0x53415649, true);
    view.setUint32(offset + 22, crc32(result, offset, pageEnd), true);
    offset = pageEnd;
  }
  return result;
}

function pages(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: {
    serial: number;
    sequence: number;
    flags: number;
    offset: number;
    end: number;
  }[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const lacingCount = bytes[offset + 26];
    const headerEnd = offset + 27 + lacingCount;
    const bodyBytes = bytes
      .subarray(offset + 27, headerEnd)
      .reduce((sum, value) => sum + value, 0);
    found.push({
      serial: view.getUint32(offset + 14, true),
      sequence: view.getUint32(offset + 18, true),
      flags: bytes[offset + 5],
      offset,
      end: headerEnd + bodyBytes,
    });
    offset = headerEnd + bodyBytes;
  }
  return found;
}

describe("Local preview audio remuxing", () => {
  const segments = [
    useCompanionSerial(decode(opus440Base64)),
    useCompanionSerial(decode(opus880Base64)),
  ];
  const metadata = segments.map((segment, sequence) => ({
    sequence,
    bytes: segment.byteLength,
  }));
  const encoded = segments.map((segment) =>
    btoa(String.fromCharCode(...segment)),
  );

  it("remuxes two same-serial encoded links in timeline order", async () => {
    const inputSerials = segments.map((segment) =>
      new DataView(segment.buffer).getUint32(14, true),
    );
    expect(new Set(inputSerials).size).toBe(1);
    const order: number[] = [];
    let readsInProgress = 0;
    let maximumReadsInProgress = 0;
    const output = await loadPreviewAudio(metadata, async (sequence) => {
      order.push(sequence);
      readsInProgress++;
      maximumReadsInProgress = Math.max(
        maximumReadsInProgress,
        readsInProgress,
      );
      await Promise.resolve();
      readsInProgress--;
      return { base64: encoded[sequence], format: "ogg" };
    });

    const outputPages = pages(output);
    const serials = [...new Set(outputPages.map((page) => page.serial))];
    expect(order).toEqual([0, 1]);
    expect(maximumReadsInProgress).toBe(1);
    expect(serials).toHaveLength(2);
    expect(serials[0]).not.toBe(serials[1]);
    expect(outputPages[0].flags & 2).toBe(2);
    expect(
      outputPages.find((page) => page.serial === serials[1])?.flags! & 2,
    ).toBe(2);
    for (const serial of serials) {
      const linkPages = outputPages.filter((page) => page.serial === serial);
      expect(linkPages.map((page) => page.sequence)).toEqual(
        linkPages.map((_, index) => index),
      );
      expect(linkPages.at(-1)?.flags! & 4).toBe(4);
    }
    for (const page of outputPages)
      expect(
        new DataView(output.buffer).getUint32(page.offset + 22, true),
      ).toBe(crc32(output, page.offset, page.end));
  });

  it("accepts the 120-chunk source limit while reading one chunk at a time", async () => {
    const chunks = Array.from({ length: 120 }, (_, sequence) => ({
      sequence,
      bytes: segments[0].byteLength,
    }));
    let activeReads = 0;
    let maximumActiveReads = 0;
    let reads = 0;
    const output = await loadPreviewAudio(chunks, async () => {
      reads++;
      activeReads++;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      await Promise.resolve();
      activeReads--;
      return { base64: encoded[0], format: "ogg" };
    });
    const outputPages = pages(output);

    expect(reads).toBe(120);
    expect(maximumActiveReads).toBe(1);
    expect(output.byteLength).toBe(segments[0].byteLength * 120);
    expect(new Set(outputPages.map((page) => page.serial)).size).toBe(120);
  });

  it("rejects corrupt pages and byte counts that differ from the manifest", async () => {
    const corrupt = segments[0].slice();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(
      loadPreviewAudio([metadata[0]], async () => ({
        base64: btoa(String.fromCharCode(...corrupt)),
        format: "ogg",
      })),
    ).rejects.toThrow(/invalid|corrupt/i);
    await expect(
      loadPreviewAudio(
        [{ ...metadata[0], bytes: metadata[0].bytes + 1 }],
        async () => ({ base64: encoded[0], format: "ogg" }),
      ),
    ).rejects.toThrow(/size|length|manifest/i);
  });

  it("rejects invalid, unordered, and oversized manifests before reading", async () => {
    let readCount = 0;
    const read = async () => {
      readCount++;
      return { base64: encoded[0], format: "ogg" };
    };
    await expect(loadPreviewAudio([], read)).rejects.toThrow(
      /no captured audio/i,
    );
    await expect(
      loadPreviewAudio([{ sequence: 1, bytes: segments[0].byteLength }], read),
    ).rejects.toThrow(/sequence|order/i);
    await expect(
      loadPreviewAudio(
        Array.from({ length: 121 }, (_, sequence) => ({
          sequence,
          bytes: segments[0].byteLength,
        })),
        read,
      ),
    ).rejects.toThrow(/limit|large|too many/i);
    expect(readCount).toBe(0);
  });
});
