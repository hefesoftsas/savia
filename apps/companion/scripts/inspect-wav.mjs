import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// This bounded feasibility inspector intentionally supports PCM16 RIFF only.
export const MAX_INSPECTION_BYTES = 64 * 1024 * 1024;

export function inspectWav(buffer) {
  if (buffer.length > MAX_INSPECTION_BYTES)
    throw new Error("Inspection limit is 64 MiB; inspect a short sample.");
  if (buffer.length < 12) throw new Error("Truncated WAV header.");
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Expected a PCM16 RIFF/WAVE container.");
  }
  const end = buffer.readUInt32LE(4) + 8;
  if (end !== buffer.length)
    throw new Error("Truncated container or trailing bytes.");
  let format;
  let audio;
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) throw new Error("Truncated chunk header.");
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const next = start + size + (size % 2);
    if (next > end) throw new Error("Truncated chunk payload.");
    if (id === "fmt ") {
      if (format || size < 16)
        throw new Error("Invalid or duplicate format chunk.");
      format = {
        codec: buffer.readUInt16LE(start),
        channelCount: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12),
        bits: buffer.readUInt16LE(start + 14),
      };
    }
    if (id === "data") {
      if (audio) throw new Error("Multiple data chunks are unsupported.");
      audio = buffer.subarray(start, start + size);
    }
    offset = next;
  }
  if (!format || !audio) throw new Error("Missing format or data chunk.");
  const { codec, channelCount, sampleRate, byteRate, blockAlign, bits } =
    format;
  if (codec !== 1 || bits !== 16 || ![1, 2].includes(channelCount)) {
    throw new Error("Only mono/stereo PCM16 is supported.");
  }
  if (!sampleRate || byteRate !== sampleRate * channelCount * 2)
    throw new Error("Invalid sample or byte rate.");
  if (blockAlign !== channelCount * 2 || audio.length % blockAlign)
    throw new Error("Incomplete or inconsistent PCM frame.");
  const frames = audio.length / blockAlign;
  if (!frames) throw new Error("Empty audio.");
  const channels = Array.from({ length: channelCount }, (_, channel) => {
    let squares = 0;
    let peak = 0;
    let zeroSamples = 0;
    let clippedSamples = 0;
    for (let frame = 0; frame < frames; frame++) {
      const sample = audio.readInt16LE(frame * blockAlign + channel * 2);
      const normalized = sample / 32768;
      squares += normalized * normalized;
      peak = Math.max(peak, Math.abs(normalized));
      if (sample === 0) zeroSamples++;
      if (sample === -32768 || sample === 32767) clippedSamples++;
    }
    return {
      channel,
      rms: Math.sqrt(squares / frames),
      peak,
      zeroSampleRatio: zeroSamples / frames,
      clippedSampleRatio: clippedSamples / frames,
    };
  });
  return {
    format: "pcm16",
    sampleRate,
    channelCount,
    frames,
    durationSeconds: frames / sampleRate,
    channels,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === "--help") {
    console.log(
      "Usage: pnpm --filter @savia/companion audio:inspect <short-pcm16-wav-file>",
    );
    if (args[0] !== "--help") process.exitCode = 1;
    return;
  }
  const file = await open(args[0], "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_INSPECTION_BYTES)
      throw new Error("Expected a regular file no larger than 64 MiB.");
    // Bound the read even if the file grows after stat; do not inspect a live recording.
    const buffer = Buffer.alloc(stat.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await file.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead !== stat.size)
      throw new Error(
        "File changed during inspection; use a finalized sample.",
      );
    console.log(
      JSON.stringify(inspectWav(buffer.subarray(0, bytesRead)), null, 2),
    );
  } finally {
    await file.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
