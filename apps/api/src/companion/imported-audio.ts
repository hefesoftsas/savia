import { z } from "@hono/zod-openapi";

export const MAX_RECORDING_BYTES = 50_000_000;
export const importedAudioFormatSchema = z.enum(["wav", "ogg", "mp3", "m4a"]);
export type ImportedAudioFormat = z.infer<typeof importedAudioFormatSchema>;

const invalid = (): never => {
  throw new Error("Invalid imported audio content.");
};
const oggCrcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte << 24;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  return crc >>> 0;
});

function inspectWav(bytes: Uint8Array): number {
  if (bytes.length < 44) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  if (
    tag(0) !== "RIFF" ||
    tag(8) !== "WAVE" ||
    view.getUint32(4, true) + 8 !== bytes.length
  )
    invalid();
  let channels = 0,
    sampleRate = 0,
    bytesPerFrame = 0,
    audioBytes: number | undefined;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) invalid();
    const size = view.getUint32(offset + 4, true),
      start = offset + 8;
    const next = start + size + (size & 1);
    if (next > bytes.length) invalid();
    if (tag(offset) === "fmt ") {
      if (sampleRate || size < 16 || view.getUint16(start, true) !== 1)
        invalid();
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bytesPerFrame = view.getUint16(start + 12, true);
      if (
        ![1, 2].includes(channels) ||
        !sampleRate ||
        sampleRate > 192000 ||
        view.getUint16(start + 14, true) !== 16 ||
        bytesPerFrame !== channels * 2 ||
        view.getUint32(start + 8, true) !== sampleRate * bytesPerFrame
      )
        invalid();
    }
    if (tag(offset) === "data") {
      if (audioBytes !== undefined) invalid();
      audioBytes = size;
    }
    offset = next;
  }
  if (!sampleRate) invalid();
  const validAudioBytes = audioBytes ?? invalid();
  if (validAudioBytes <= 0 || validAudioBytes % bytesPerFrame) invalid();
  return validAudioBytes / (sampleRate * bytesPerFrame);
}

function inspectOgg(bytes: Uint8Array): number | null {
  let offset = 0,
    sequence = 0,
    serial: number | undefined,
    preSkip = 0,
    finalGranule: bigint | undefined;
  let firstPacket: number[] = [],
    packetIndex = 0,
    pending = false,
    ended = false;
  while (offset < bytes.length) {
    if (
      ended ||
      offset + 27 > bytes.length ||
      String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== "OggS" ||
      bytes[offset + 4] !== 0
    )
      invalid();
    const flags = bytes[offset + 5],
      segments = bytes[offset + 26],
      headerEnd = offset + 27 + segments;
    if (
      headerEnd > bytes.length ||
      flags & ~7 ||
      Boolean(flags & 1) !== pending ||
      Boolean(flags & 2) !== (sequence === 0)
    )
      invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pageSerial = view.getUint32(offset + 14, true);
    serial ??= pageSerial;
    if (
      pageSerial !== serial ||
      view.getUint32(offset + 18, true) !== sequence++
    )
      invalid();
    const lacing = bytes.subarray(offset + 27, headerEnd);
    const pageEnd = headerEnd + lacing.reduce((sum, b) => sum + b, 0);
    if (pageEnd > bytes.length) invalid();
    let crc = 0;
    for (let at = offset; at < pageEnd; at++) {
      const value = at >= offset + 22 && at < offset + 26 ? 0 : bytes[at];
      crc = ((crc << 8) ^ oggCrcTable[((crc >>> 24) ^ value) & 255]) >>> 0;
    }
    if (crc !== view.getUint32(offset + 22, true)) invalid();
    let body = headerEnd;
    for (const size of lacing) {
      if (firstPacket.length < 64)
        firstPacket.push(
          ...bytes.subarray(
            body,
            body + Math.min(size, 64 - firstPacket.length),
          ),
        );
      body += size;
      pending = size === 255;
      if (!pending) {
        const packet = new Uint8Array(firstPacket);
        if (packetIndex === 0) {
          if (
            packet.length !== 19 ||
            String.fromCharCode(...packet.subarray(0, 8)) !== "OpusHead" ||
            packet[8] !== 1 ||
            ![1, 2].includes(packet[9])
          )
            invalid();
          preSkip = new DataView(packet.buffer).getUint16(10, true);
        } else if (
          packetIndex === 1 &&
          (packet.length < 8 ||
            String.fromCharCode(...packet.subarray(0, 8)) !== "OpusTags")
        )
          invalid();
        packetIndex++;
        firstPacket = [];
      }
    }
    const granule = view.getBigUint64(offset + 6, true);
    if (granule !== 0xffffffffffffffffn) finalGranule = granule;
    if (flags & 4) {
      if (pageEnd !== bytes.length || pending) invalid();
      ended = true;
    }
    offset = pageEnd;
  }
  if (
    !ended ||
    packetIndex < 3 ||
    finalGranule === undefined ||
    finalGranule <= BigInt(preSkip)
  )
    invalid();
  return (Number(finalGranule) - preSkip) / 48000;
}

function inspectMp3(bytes: Uint8Array): number | null {
  let offset = 0;
  if (
    bytes.length >= 10 &&
    String.fromCharCode(...bytes.subarray(0, 3)) === "ID3"
  ) {
    const s = bytes.subarray(6, 10);
    if (s.some((b) => b & 0x80)) invalid();
    offset = 10 + ((s[0] << 21) | (s[1] << 14) | (s[2] << 7) | s[3]);
  }
  const bitrates: Record<string, number[]> = {
    "1-1": [
      0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448,
    ],
    "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };
  const rates = [44100, 48000, 32000];
  let frames = 0,
    seconds = 0;
  while (offset + 4 <= bytes.length) {
    const h = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      4,
    ).getUint32(0, false);
    if (h >>> 21 !== 0x7ff) break;
    const verBits = (h >>> 19) & 3,
      layerBits = (h >>> 17) & 3,
      bitrateIndex = (h >>> 12) & 15,
      rateIndex = (h >>> 10) & 3;
    if (
      verBits === 1 ||
      layerBits === 0 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      rateIndex === 3
    )
      break;
    const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 2.5,
      layer = 4 - layerBits;
    const rate = rates[rateIndex] / (version === 1 ? 1 : version === 2 ? 2 : 4);
    const bitrateVersion = version === 1 ? 1 : 2;
    const kbps = bitrates[`${bitrateVersion}-${layer}`]?.[bitrateIndex];
    if (!kbps) break;
    const padding = (h >>> 9) & 1;
    const frameBytes =
      (Math.floor(
        ((layer === 1 ? 12 : version === 1 || layer === 2 ? 144 : 72) *
          kbps *
          1000) /
          rate,
      ) +
        padding) *
      (layer === 1 ? 4 : 1);
    if (offset + frameBytes > bytes.length) break;
    seconds +=
      (layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152) / rate;
    frames++;
    offset += frameBytes;
  }
  if (!frames) invalid();
  if (offset !== bytes.length) {
    const tail = bytes.subarray(offset);
    if (
      tail.length !== 128 ||
      String.fromCharCode(...tail.subarray(0, 3)) !== "TAG"
    )
      invalid();
  }
  return seconds;
}

function inspectM4a(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0,
    hasFtyp = false,
    hasMoov = false,
    hasMdat = false,
    hasSoundTrack = false,
    duration: number | null = null;
  const boxes = (start: number, end: number, depth: number): void => {
    if (depth > 8) return;
    for (let at = start; at + 8 <= end;) {
      let size = view.getUint32(at, false);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) invalid();
        const wide = view.getBigUint64(at + 8, false);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
        size = Number(wide);
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) invalid();
      if (type === "ftyp" && at === 0) hasFtyp = size >= 16;
      if (type === "moov") hasMoov = true;
      if (type === "mdat") hasMdat = size > header;
      if (
        type === "hdlr" &&
        size >= header + 12 &&
        String.fromCharCode(
          ...bytes.subarray(at + header + 8, at + header + 12),
        ) === "soun"
      )
        hasSoundTrack = true;
      if (type === "mvhd" || type === "mdhd") {
        const version = bytes[at + header];
        const timeAt = at + header + (version === 1 ? 20 : 12);
        if (timeAt + (version === 1 ? 12 : 8) <= at + size) {
          const scale = view.getUint32(timeAt, false);
          const units =
            version === 1
              ? Number(view.getBigUint64(timeAt + 4, false))
              : view.getUint32(timeAt + 4, false);
          if (scale && units) duration = units / scale;
        }
      }
      if (["moov", "trak", "mdia"].includes(type))
        boxes(at + header, at + size, depth + 1);
      at += size;
    }
  };
  boxes(offset, bytes.length, 0);
  if (!hasFtyp || !hasMoov || !hasMdat || !hasSoundTrack) invalid();
  return duration;
}

export function inspectImportedAudio(
  bytes: Uint8Array,
  format: ImportedAudioFormat,
): { durationSeconds: number | null } {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) invalid();
  if (bytes.byteLength > MAX_RECORDING_BYTES)
    throw new Error("Imported audio exceeds the 50 MB limit.");
  let durationSeconds: number | null;
  switch (format) {
    case "wav":
      durationSeconds = inspectWav(bytes);
      break;
    case "ogg":
      durationSeconds = inspectOgg(bytes);
      break;
    case "mp3":
      durationSeconds = inspectMp3(bytes);
      break;
    case "m4a":
      durationSeconds = inspectM4a(bytes);
      break;
  }
  if (
    durationSeconds !== null &&
    (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
  )
    invalid();
  return { durationSeconds };
}
