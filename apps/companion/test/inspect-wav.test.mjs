import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectWav } from "../scripts/inspect-wav.mjs";

function wav(samples, channels = 1) {
  const result = Buffer.alloc(44 + samples.length * 2);
  result.write("RIFF");
  result.writeUInt32LE(result.length - 8, 4);
  result.write("WAVE", 8);
  result.write("fmt ", 12);
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(channels, 22);
  result.writeUInt32LE(16000, 24);
  result.writeUInt32LE(16000 * channels * 2, 28);
  result.writeUInt16LE(channels * 2, 32);
  result.writeUInt16LE(16, 34);
  result.write("data", 36);
  result.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => result.writeInt16LE(value, 44 + index * 2));
  return result;
}

test("measures separate stereo channels without treating them as speakers", () => {
  const result = inspectWav(wav([0, 32767, 0, -32768], 2));
  assert.equal(result.frames, 2);
  assert.equal(result.durationSeconds, 2 / 16000);
  assert.equal(result.channels[0].zeroSampleRatio, 1);
  assert.equal(result.channels[0].rms, 0);
  assert.equal(result.channels[1].clippedSampleRatio, 1);
  assert.ok(result.channels[1].rms > 0.99);
});

test("rejects truncated containers and empty audio", () => {
  assert.throws(() => inspectWav(wav([1]).subarray(0, 45)), /truncated/i);
  assert.throws(() => inspectWav(wav([])), /empty/i);
});

test("rejects unsupported codecs and inconsistent frames", () => {
  const compressed = wav([1]);
  compressed.writeUInt16LE(3, 20);
  assert.throws(() => inspectWav(compressed), /PCM16/i);
  assert.throws(() => inspectWav(wav([1], 2)), /frame/i);
});

test("rejects invalid sample rate and inconsistent byte rate", () => {
  const invalid = wav([1]);
  invalid.writeUInt32LE(0, 24);
  assert.throws(() => inspectWav(invalid), /rate/i);
  const byteRate = wav([1]);
  byteRate.writeUInt32LE(7, 28);
  assert.throws(() => inspectWav(byteRate), /rate/i);
});

test("accepts padded ancillary chunks before data", () => {
  const source = wav([100]);
  const ancillary = Buffer.alloc(10);
  ancillary.write("JUNK");
  ancillary.writeUInt32LE(1, 4);
  const result = Buffer.concat([
    source.subarray(0, 36),
    ancillary,
    source.subarray(36),
  ]);
  result.writeUInt32LE(result.length - 8, 4);
  assert.equal(inspectWav(result).frames, 1);
});
