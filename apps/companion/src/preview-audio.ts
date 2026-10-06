export const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
const MAX_PREVIEW_CHUNK_BYTES = 512 * 1024;
const MAX_PREVIEW_CHUNKS = 120;
const MAX_PREVIEW_SECONDS = 60;

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte << 24;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  return crc >>> 0;
});

const invalidOgg = () => new Error("Captured audio is invalid or corrupt.");

function pageChecksum(page: Uint8Array): number {
  let crc = 0;
  for (let offset = 0; offset < page.length; offset++) {
    const value = offset >= 22 && offset < 26 ? 0 : page[offset];
    crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ value) & 255]) >>> 0;
  }
  return crc;
}

function packetFrames(packet: Uint8Array): number {
  if (!packet.length) throw invalidOgg();
  const config = packet[0] >>> 3;
  const frameSamples =
    config >= 16
      ? 120 << (config & 3)
      : config >= 12
        ? 480 << (config & 1)
        : (config & 3) === 3
          ? 2880
          : 480 << (config & 3);
  const code = packet[0] & 3;
  const count =
    code === 0 ? 1 : code < 3 ? 2 : packet.length > 1 ? packet[1] & 63 : 0;
  if (!count || count > 48 || count * frameSamples > 5760) throw invalidOgg();
  return count * frameSamples;
}

/** Validate one complete, bounded mono Opus logical stream. */
function validateOggOpus(bytes: Uint8Array): void {
  if (bytes.length < 64 || bytes.length > MAX_PREVIEW_CHUNK_BYTES)
    throw invalidOgg();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  let offset = 0;
  let sequence = 0;
  let serial: number | undefined;
  let packetIndex = 0;
  let preSkip = 0;
  let decoded = 0;
  let lastFrames = 0;
  let fragments: Uint8Array[] = [];
  let packetBytes = 0;
  let ended = false;
  let previousGranule = 0n;
  let endGranule = 0n;

  while (offset < bytes.length) {
    if (
      ended ||
      offset + 27 > bytes.length ||
      tag(offset, 4) !== "OggS" ||
      bytes[offset + 4] !== 0
    )
      throw invalidOgg();
    const flags = bytes[offset + 5];
    const lacingCount = bytes[offset + 26];
    const headerEnd = offset + 27 + lacingCount;
    if (
      flags & ~7 ||
      Boolean(flags & 1) !== Boolean(packetBytes) ||
      Boolean(flags & 2) !== (sequence === 0) ||
      headerEnd > bytes.length
    )
      throw invalidOgg();

    const pageSerial = view.getUint32(offset + 14, true);
    serial ??= pageSerial;
    if (
      pageSerial !== serial ||
      view.getUint32(offset + 18, true) !== sequence++
    )
      throw invalidOgg();

    const lacing = bytes.subarray(offset + 27, headerEnd);
    const pageEnd = headerEnd + lacing.reduce((sum, size) => sum + size, 0);
    if (pageEnd > bytes.length) throw invalidOgg();
    if (
      pageChecksum(bytes.subarray(offset, pageEnd)) !==
      view.getUint32(offset + 22, true)
    )
      throw invalidOgg();

    const granule = view.getBigUint64(offset + 6, true);
    let body = headerEnd;
    let completed = 0;
    for (const size of lacing) {
      fragments.push(bytes.subarray(body, body + size));
      body += size;
      packetBytes += size;
      if (packetBytes > 65536) throw invalidOgg();
      if (size === 255) continue;

      const packet = new Uint8Array(packetBytes);
      let packetOffset = 0;
      for (const fragment of fragments) {
        packet.set(fragment, packetOffset);
        packetOffset += fragment.length;
      }
      fragments = [];
      packetBytes = 0;
      completed++;

      if (packetIndex === 0) {
        if (
          packet.length !== 19 ||
          String.fromCharCode(...packet.subarray(0, 8)) !== "OpusHead" ||
          packet[8] !== 1 ||
          packet[9] !== 1 ||
          packet[18] !== 0
        )
          throw invalidOgg();
        preSkip = new DataView(packet.buffer).getUint16(10, true);
        if (preSkip > 3840) throw invalidOgg();
      } else if (packetIndex === 1) {
        if (
          packet.length < 16 ||
          String.fromCharCode(...packet.subarray(0, 8)) !== "OpusTags"
        )
          throw invalidOgg();
        const tags = new DataView(packet.buffer);
        const vendorLength = tags.getUint32(8, true);
        if (vendorLength > 4096 || 16 + vendorLength > packet.length)
          throw invalidOgg();
        const comments = tags.getUint32(12 + vendorLength, true);
        if (comments > 32) throw invalidOgg();
        let tagOffset = 16 + vendorLength;
        for (let index = 0; index < comments; index++) {
          if (tagOffset + 4 > packet.length) throw invalidOgg();
          tagOffset += 4 + tags.getUint32(tagOffset, true);
          if (tagOffset > packet.length) throw invalidOgg();
        }
      } else {
        lastFrames = packetFrames(packet);
        decoded += lastFrames;
        if (decoded > MAX_PREVIEW_SECONDS * 48000 + preSkip + 5760)
          throw invalidOgg();
      }
      packetIndex++;
    }

    if (
      sequence === 1 &&
      (completed !== 1 ||
        packetBytes !== 0 ||
        packetIndex !== 1 ||
        granule !== 0n)
    )
      throw invalidOgg();
    if (granule !== 0xffffffffffffffffn) {
      if (granule < previousGranule || granule > BigInt(decoded))
        throw invalidOgg();
      previousGranule = granule;
    } else if (completed || flags & 4) {
      throw invalidOgg();
    }
    if (flags & 4) {
      if (
        packetIndex < 3 ||
        !completed ||
        packetBytes ||
        pageEnd !== bytes.length
      )
        throw invalidOgg();
      ended = true;
      endGranule = granule;
    }
    offset = pageEnd;
  }

  if (
    !ended ||
    endGranule <= BigInt(preSkip) ||
    endGranule < BigInt(decoded - lastFrames) ||
    (Number(endGranule) - preSkip) / 48000 > MAX_PREVIEW_SECONDS
  )
    throw invalidOgg();
}

function appendOggOpusLink(
  output: Uint8Array<ArrayBuffer>,
  outputOffset: number,
  segment: Uint8Array<ArrayBuffer>,
  outputSerial: number,
): number {
  validateOggOpus(segment);
  const targetView = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  let inputOffset = 0;
  while (inputOffset < segment.length) {
    const lacingCount = segment[inputOffset + 26];
    const headerEnd = inputOffset + 27 + lacingCount;
    const bodyBytes = segment
      .subarray(inputOffset + 27, headerEnd)
      .reduce((sum, size) => sum + size, 0);
    const pageEnd = headerEnd + bodyBytes;
    const pageLength = pageEnd - inputOffset;
    if (pageLength > output.byteLength - outputOffset)
      throw new Error("Captured audio exceeds the preview size limit.");

    output.set(segment.subarray(inputOffset, pageEnd), outputOffset);
    targetView.setUint32(outputOffset + 14, outputSerial, true);
    output.fill(0, outputOffset + 22, outputOffset + 26);
    targetView.setUint32(
      outputOffset + 22,
      pageChecksum(output.subarray(outputOffset, outputOffset + pageLength)),
      true,
    );
    inputOffset = pageEnd;
    outputOffset += pageLength;
  }
  return outputOffset;
}

export type PreviewChunk = { sequence: number; bytes: number };
export type PreviewChunkData = { base64: string; format: string };

/** Read and remux one bounded Ogg Opus chunk at a time in timeline order. */
export async function loadPreviewAudio(
  chunks: readonly PreviewChunk[],
  readChunk: (sequence: number) => Promise<PreviewChunkData>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!chunks.length)
    throw new Error("There is no captured audio to preview yet.");
  if (chunks.length > MAX_PREVIEW_CHUNKS)
    throw new Error("Captured audio exceeds the preview chunk limit.");

  let totalBytes = 0;
  for (const [index, chunk] of chunks.entries()) {
    if (
      !Number.isSafeInteger(chunk.sequence) ||
      chunk.sequence !== index ||
      !Number.isSafeInteger(chunk.bytes) ||
      chunk.bytes <= 0 ||
      chunk.bytes > MAX_PREVIEW_CHUNK_BYTES
    )
      throw new Error(
        "Captured audio manifest has an invalid sequence or size.",
      );
    totalBytes += chunk.bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_PREVIEW_BYTES)
      throw new Error("Captured audio exceeds the preview size limit.");
  }

  const output: Uint8Array<ArrayBuffer> = new Uint8Array(totalBytes);
  let outputOffset = 0;
  for (const chunk of chunks) {
    const data = await readChunk(chunk.sequence);
    if (data?.format !== "ogg" || typeof data.base64 !== "string")
      throw new Error("Captured audio is unavailable for preview.");
    const expectedBase64Length = Math.ceil(chunk.bytes / 3) * 4;
    if (
      data.base64.length !== expectedBase64Length ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        data.base64,
      )
    )
      throw new Error("Captured audio size does not match its manifest.");

    let binary: string;
    try {
      binary = atob(data.base64);
    } catch {
      throw new Error("Captured audio is unavailable for preview.");
    }
    if (binary.length !== chunk.bytes)
      throw new Error("Captured audio size does not match its manifest.");
    const segment = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++)
      segment[index] = binary.charCodeAt(index);
    outputOffset = appendOggOpusLink(
      output,
      outputOffset,
      segment,
      chunk.sequence + 1,
    );
  }
  if (outputOffset !== totalBytes)
    throw new Error("Captured audio output does not match its manifest.");
  return output;
}
