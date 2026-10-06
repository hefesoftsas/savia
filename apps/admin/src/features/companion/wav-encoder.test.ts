import { describe, expect, it } from "vitest";
import { encodeWavMono16 } from "./wav-encoder";

describe("encodeWavMono16", () => {
  it("writes a valid PCM16 mono header with exact sizes", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const bytes = encodeWavMono16([samples], 16000);
    expect(bytes.length).toBe(44 + samples.length * 2);
    const tag = (at: number) =>
      String.fromCharCode(...bytes.subarray(at, at + 4));
    const view = new DataView(bytes.buffer);
    expect(tag(0)).toBe("RIFF");
    expect(view.getUint32(4, true) + 8).toBe(bytes.length);
    expect(tag(8)).toBe("WAVE");
    expect(tag(12)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(Math.floor(0.5 * 0x7fff));
    expect(view.getInt16(50, true)).toBe(0x7fff);
    expect(view.getInt16(52, true)).toBe(-0x8000);
  });

  it("concatenates chunks and clamps out-of-range samples", () => {
    const bytes = encodeWavMono16(
      [new Float32Array([2]), new Float32Array([-2, 0.25])],
      48000,
    );
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(44 + 3 * 2);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getUint32(24, true)).toBe(48000);
  });

  it("rejects unsupported sample rates", () => {
    expect(() => encodeWavMono16([], 0)).toThrow();
    expect(() => encodeWavMono16([], 300000)).toThrow();
  });
});
