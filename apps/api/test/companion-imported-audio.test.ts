import { describe, expect, it } from "vitest";
import { CompanionService } from "../src/companion/service";
import { opusFixture } from "./fixtures/companion-tone";
import {
  MAX_RECORDING_BYTES,
  importedAudioFormatSchema,
  inspectImportedAudio,
} from "../src/companion/imported-audio";

function wav(seconds = 75) {
  const dataBytes = seconds * 16000 * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, value: string) =>
    Array.from(value).forEach((c, i) => (bytes[offset + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}
function mp3({ version = 3, layer = 1, bitrate = 9 } = {}) {
  const rates = [44100, 48000, 32000];
  const sampleRate = rates[0] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const table =
    version === 3
      ? layer === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : layer === 2
          ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
          : [
              0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416,
              448,
            ]
      : layer === 1
        ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const kbps = table[bitrate];
  const frameLength =
    Math.floor(
      ((layer === 1 ? 12 : version === 3 || layer === 2 ? 144 : 72) *
        kbps *
        1000) /
        sampleRate,
    ) * (layer === 1 ? 4 : 1);
  const bytes = new Uint8Array(frameLength * 2);
  const header =
    (0x7ff << 21) | (version << 19) | ((4 - layer) << 17) | (bitrate << 12);
  new DataView(bytes.buffer).setUint32(0, header, false);
  new DataView(bytes.buffer).setUint32(frameLength, header, false);
  return bytes;
}
function box(type: string, payload: Uint8Array) {
  const bytes = new Uint8Array(8 + payload.length);
  new DataView(bytes.buffer).setUint32(0, bytes.length, false);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(payload, 8);
  return bytes;
}
function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
function m4a() {
  const ftyp = box("ftyp", new TextEncoder().encode("M4A \0\0\0\0M4A "));
  const mvhdPayload = new Uint8Array(20);
  new DataView(mvhdPayload.buffer).setUint32(12, 1000, false);
  new DataView(mvhdPayload.buffer).setUint32(16, 75000, false);
  const mvhd = box("mvhd", mvhdPayload);
  const hdlrPayload = new Uint8Array(12);
  hdlrPayload.set(new TextEncoder().encode("soun"), 8);
  const hdlr = box("hdlr", hdlrPayload);
  const mdia = box("mdia", hdlr);
  const trak = box("trak", mdia);
  const moov = box("moov", concat(mvhd, trak));
  const mdat = box("mdat", new Uint8Array([1]));
  return concat(ftyp, moov, mdat);
}
function stereoOpus() {
  const bytes = opusFixture();
  const headerEnd = 27 + bytes[26];
  bytes[headerEnd + 9] = 2;
  const pageEnd =
    headerEnd + bytes.subarray(27, headerEnd).reduce((sum, n) => sum + n, 0);
  bytes.fill(0, 22, 26);
  const table = Uint32Array.from({ length: 256 }, (_, byte) => {
    let value = byte << 24;
    for (let bit = 0; bit < 8; bit++)
      value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    return value >>> 0;
  });
  let crc = 0;
  for (let at = 0; at < pageEnd; at++) {
    const value = at >= 22 && at < 26 ? 0 : bytes[at];
    crc = ((crc << 8) ^ table[((crc >>> 24) ^ value) & 255]) >>> 0;
  }
  new DataView(bytes.buffer).setUint32(22, crc, true);
  return bytes;
}

describe("imported recording audio inspection", () => {
  it("defines supported formats and the decimal upload limit", () => {
    expect(MAX_RECORDING_BYTES).toBe(50_000_000);
    expect(importedAudioFormatSchema.options).toEqual([
      "wav",
      "ogg",
      "mp3",
      "m4a",
    ]);
  });
  it("validates real WAV content and derives duration without the short-recording cap", () => {
    expect(inspectImportedAudio(wav(), "wav").durationSeconds).toBe(75);
    expect(() =>
      inspectImportedAudio(new TextEncoder().encode("not audio"), "wav"),
    ).toThrow();
  });
  it("accepts stereo Opus and common MPEG 1 and 2.5 MP3 frame layouts", () => {
    expect(
      inspectImportedAudio(stereoOpus(), "ogg").durationSeconds,
    ).toBeCloseTo(0.1);
    expect(inspectImportedAudio(mp3(), "mp3").durationSeconds).toBeGreaterThan(
      0,
    );
    expect(
      inspectImportedAudio(mp3({ version: 0, layer: 1, bitrate: 1 }), "mp3")
        .durationSeconds,
    ).toBeGreaterThan(0);
  });
  it("rejects MP3 frame truncation and junk tails plus M4A containers without audio", () => {
    const valid = mp3();
    expect(() =>
      inspectImportedAudio(valid.subarray(0, valid.length - 1), "mp3"),
    ).toThrow();
    expect(() =>
      inspectImportedAudio(concat(valid, new Uint8Array([1, 2, 3])), "mp3"),
    ).toThrow();
    expect(() =>
      inspectImportedAudio(
        box("ftyp", new TextEncoder().encode("M4A \0\0\0\0M4A ")),
        "m4a",
      ),
    ).toThrow();
    expect(inspectImportedAudio(m4a(), "m4a").durationSeconds).toBe(75);
  });
  it("rejects bytes above the imported upload limit", () => {
    expect(() =>
      inspectImportedAudio(new Uint8Array(MAX_RECORDING_BYTES + 1), "mp3"),
    ).toThrow(/50 MB/);
  });
  it("transcribes an imported long WAV as an upload source", async () => {
    let requestUrl = "";
    let requestBody: any;
    const bytes = wav(75);
    const result = await new CompanionService({
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestBody = await new Response(init!.body as ReadableStream).json();
        return Response.json({
          choices: [{ message: { content: "Imported transcript" } }],
        });
      },
    }).transcribeRecording(
      {
        apiKey: "test-key",
        model: "test/summary",
        transcriptionModel: "test/audio-input",
      },
      { bytes, format: "wav", source: "upload", durationSeconds: 75 },
    );
    expect(result).toMatchObject({
      text: "Imported transcript",
      source: "upload",
      durationSeconds: 75,
    });
    expect(requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(requestBody.model).toBe("test/audio-input");
    expect(requestBody.messages[0].content[0].text).toContain(
      "without timestamps, labels, bullets, or commentary",
    );
    expect(requestBody.messages[0].content[1].input_audio.format).toBe("wav");
    expect(requestBody.messages[0].content[1].input_audio.data).toHaveLength(
      Math.ceil(bytes.length / 3) * 4,
    );
  });
});
