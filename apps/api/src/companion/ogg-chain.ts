import { inspectOggOpus } from "./ogg";

export const MAX_OGG_CHAIN_BYTES = 64 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte << 24;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  return crc >>> 0;
});

function pageChecksum(page: Uint8Array): number {
  let crc = 0;
  for (let offset = 0; offset < page.length; offset++) {
    const value = offset >= 22 && offset < 26 ? 0 : page[offset];
    crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ value) & 255]) >>> 0;
  }
  return crc;
}

/** Validate and append one complete Ogg Opus link to a preallocated output. */
export function appendOggOpusLink(
  target: Uint8Array<ArrayBuffer>,
  targetOffset: number,
  segment: Uint8Array,
  serial: number,
): number {
  if (
    !(target instanceof Uint8Array) ||
    target.byteLength > MAX_OGG_CHAIN_BYTES ||
    !Number.isInteger(targetOffset) ||
    targetOffset < 0 ||
    targetOffset > target.byteLength ||
    !Number.isInteger(serial) ||
    serial < 0 ||
    serial > 0xffffffff
  )
    throw new Error("Invalid Ogg Opus output buffer.");

  inspectOggOpus(segment);
  if (segment.byteLength > target.byteLength - targetOffset)
    throw new Error("Ogg Opus output buffer is too small.");

  const targetView = new DataView(
    target.buffer,
    target.byteOffset,
    target.byteLength,
  );
  let inputOffset = 0;
  let outputOffset = targetOffset;
  while (inputOffset < segment.byteLength) {
    const segmentCount = segment[inputOffset + 26];
    const headerEnd = inputOffset + 27 + segmentCount;
    let bodyBytes = 0;
    for (let index = inputOffset + 27; index < headerEnd; index++)
      bodyBytes += segment[index];
    const pageEnd = headerEnd + bodyBytes;
    const pageLength = pageEnd - inputOffset;

    target.set(segment.subarray(inputOffset, pageEnd), outputOffset);
    // Give each logical stream its own serial; page sequence/granules/packets
    // remain unchanged, while the page checksum is recomputed below.
    targetView.setUint32(outputOffset + 14, serial, true);
    target.fill(0, outputOffset + 22, outputOffset + 26);
    targetView.setUint32(
      outputOffset + 22,
      pageChecksum(target.subarray(outputOffset, outputOffset + pageLength)),
      true,
    );
    inputOffset = pageEnd;
    outputOffset += pageLength;
  }
  return outputOffset;
}
