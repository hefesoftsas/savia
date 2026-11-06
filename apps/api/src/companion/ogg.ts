// Limited, single-stream mono Ogg Opus inspection; it does not decode speech.
export const MAX_OPUS_BYTES = 512 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte << 24;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  return crc >>> 0;
});
const invalid = (): never => {
  throw new Error("Invalid bounded mono Ogg Opus sample.");
};
function frames(packet: Uint8Array): number {
  if (!packet.length) invalid();
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
  if (!count || count > 48 || count * frameSamples > 5760) invalid();
  return count * frameSamples;
}
export function inspectOggOpus(bytes: Uint8Array): { durationSeconds: number } {
  if (bytes.length < 64 || bytes.length > MAX_OPUS_BYTES) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number, n: number) =>
    String.fromCharCode(...bytes.subarray(at, at + n));
  let offset = 0,
    sequence = 0,
    serial: number | undefined,
    packetIndex = 0,
    preSkip = 0,
    decoded = 0,
    lastFrames = 0;
  let fragments: Uint8Array[] = [],
    packetBytes = 0,
    ended = false,
    previousGranule = 0n,
    endGranule = 0n;
  while (offset < bytes.length) {
    if (
      ended ||
      offset + 27 > bytes.length ||
      tag(offset, 4) !== "OggS" ||
      bytes[offset + 4] !== 0
    )
      invalid();
    const flags = bytes[offset + 5],
      count = bytes[offset + 26],
      headerEnd = offset + 27 + count;
    if (
      flags & ~7 ||
      Boolean(flags & 1) !== Boolean(packetBytes) ||
      Boolean(flags & 2) !== (sequence === 0) ||
      headerEnd > bytes.length
    )
      invalid();
    const pageSerial = view.getUint32(offset + 14, true);
    serial ??= pageSerial;
    if (
      pageSerial !== serial ||
      view.getUint32(offset + 18, true) !== sequence++
    )
      invalid();
    const lacing = bytes.subarray(offset + 27, headerEnd);
    const end = headerEnd + lacing.reduce((a, b) => a + b, 0);
    if (end > bytes.length) invalid();
    let crc = 0;
    for (let at = offset; at < end; at++) {
      const value = at >= offset + 22 && at < offset + 26 ? 0 : bytes[at];
      crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ value) & 255]) >>> 0;
    }
    if (crc !== view.getUint32(offset + 22, true)) invalid();
    const granule = view.getBigUint64(offset + 6, true);
    let body = headerEnd,
      completed = 0;
    for (const size of lacing) {
      fragments.push(bytes.subarray(body, body + size));
      body += size;
      packetBytes += size;
      if (packetBytes > 65536) invalid();
      if (size === 255) continue;
      const packet = new Uint8Array(packetBytes);
      let at = 0;
      for (const fragment of fragments) {
        packet.set(fragment, at);
        at += fragment.length;
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
          invalid();
        preSkip = new DataView(packet.buffer).getUint16(10, true);
        if (preSkip > 3840) invalid();
      } else if (packetIndex === 1) {
        if (
          packet.length < 16 ||
          String.fromCharCode(...packet.subarray(0, 8)) !== "OpusTags"
        )
          invalid();
        const tags = new DataView(packet.buffer);
        const vendor = tags.getUint32(8, true);
        if (vendor > 4096 || 16 + vendor > packet.length) invalid();
        const comments = tags.getUint32(12 + vendor, true);
        if (comments > 32) invalid();
        let pos = 16 + vendor;
        for (let i = 0; i < comments; i++) {
          if (pos + 4 > packet.length) invalid();
          const len = tags.getUint32(pos, true);
          pos += 4 + len;
          if (pos > packet.length) invalid();
        }
      } else {
        lastFrames = frames(packet);
        decoded += lastFrames;
        if (decoded > 60 * 48000 + preSkip + 5760) invalid();
      }
      packetIndex++;
    }
    if (
      sequence === 1 &&
      (completed !== 1 || packetBytes || packetIndex !== 1 || granule !== 0n)
    )
      invalid();
    if (granule !== 0xffffffffffffffffn) {
      if (granule < previousGranule || granule > BigInt(decoded)) invalid();
      previousGranule = granule;
    } else if (completed || flags & 4) invalid();
    if (flags & 4) {
      if (packetIndex < 3 || !completed || packetBytes || end !== bytes.length)
        invalid();
      ended = true;
      endGranule = granule;
    }
    offset = end;
  }
  if (
    !ended ||
    endGranule <= BigInt(preSkip) ||
    endGranule < BigInt(decoded - lastFrames)
  )
    invalid();
  const durationSeconds = (Number(endGranule) - preSkip) / 48000;
  if (durationSeconds > 60 || durationSeconds <= 0) invalid();
  return { durationSeconds };
}
