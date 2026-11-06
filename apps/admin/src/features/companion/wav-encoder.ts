/**
 * Minimal PCM16 mono WAV encoder for in-browser microphone captures.
 * The Companion recordings API validates WAV strictly (RIFF/WAVE, PCM format
 * tag, 16-bit samples, consistent sizes), so the header must be exact.
 */
export function encodeWavMono16(
  chunks: Float32Array[],
  sampleRate: number,
): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 192000)
    throw new Error("Unsupported sample rate.");
  let frames = 0;
  for (const chunk of chunks) frames += chunk.length;
  const dataBytes = frames * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const writeTag = (offset: number, tag: string) => {
    for (let i = 0; i < tag.length; i++) bytes[offset + i] = tag.charCodeAt(i);
  };
  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, Math.floor(sampleRate), true);
  view.setUint32(28, Math.floor(sampleRate) * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const clamped = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true,
      );
      offset += 2;
    }
  }
  return bytes;
}
