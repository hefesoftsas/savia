import { nativeOpusFixtureBase64 } from "./fixtures/companion-native-tone";
import { opusFixture } from "./fixtures/companion-tone";
import { describe, expect, it } from "vitest";
import { validateAudio } from "../src/companion/service";
import { inspectOggOpus } from "../src/companion/ogg";
const fixture = opusFixture();
const base64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
function checksum(bytes: Uint8Array, offset: number) {
  const n = bytes[offset + 26];
  const size =
    27 +
    n +
    Array.from(bytes.subarray(offset + 27, offset + 27 + n)).reduce(
      (a, b) => a + b,
      0,
    );
  new DataView(bytes.buffer).setUint32(offset + 22, 0, true);
  let crc = 0;
  for (const b of bytes.subarray(offset, offset + size)) {
    crc ^= b << 24;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  new DataView(bytes.buffer).setUint32(offset + 22, crc >>> 0, true);
}
describe("bounded Ogg Opus validation", () => {
  it("accepts the native encoder output with its exact effective duration", () => {
    expect(validateAudio(nativeOpusFixtureBase64, "ogg").durationSeconds).toBe(
      6575 / 48000,
    );
  });
  it("accepts independently encoded mono Opus and uses trimmed sample duration", () => {
    expect(inspectOggOpus(fixture).durationSeconds).toBeCloseTo(0.1, 6);
    expect(validateAudio(base64(fixture), "ogg").durationSeconds).toBeCloseTo(
      0.1,
      6,
    );
  });
  it("rejects corruption, truncation, appended streams and a missing end marker", () => {
    const corrupt = fixture.slice();
    corrupt[corrupt.length - 1] ^= 1;
    const noEnd = fixture.slice();
    noEnd[137 + 5] = 0;
    checksum(noEnd, 137);
    for (const bytes of [
      corrupt,
      fixture.slice(0, -1),
      new Uint8Array([...fixture, ...fixture]),
      noEnd,
    ])
      expect(() => inspectOggOpus(bytes)).toThrow();
  });
  it("rejects oversized, stereo, sequence and forged-duration containers", () => {
    const stereo = fixture.slice();
    stereo[37] = 2;
    checksum(stereo, 0);
    const wrongSequence = fixture.slice();
    new DataView(wrongSequence.buffer).setUint32(137 + 18, 9, true);
    checksum(wrongSequence, 137);
    const forged = fixture.slice();
    new DataView(forged.buffer).setBigUint64(137 + 6, 61n * 48000n, true);
    checksum(forged, 137);
    for (const bytes of [
      new Uint8Array(512 * 1024 + 1),
      stereo,
      wrongSequence,
      forged,
    ])
      expect(() => inspectOggOpus(bytes)).toThrow();
  });
});
