import { describe, expect, it } from "vitest";
import { opusFixture } from "./fixtures/companion-tone";
import { appendOggOpusLink } from "../src/companion/ogg-chain";
import { inspectOggOpus } from "../src/companion/ogg";

// Synthetic 880 Hz, 0.25 second mono Ogg Opus, independently encoded with
// ffmpeg/libopus so the chained links have distinct audio and encoder output.
const opus880HzFixtureBase64 =
  "T2dnUwACAAAAAAAAAAAyTFweAAAAANBanlQBE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAADJMXB4BAAAA+53QUgE+T3B1c1RhZ3MNAAAATGF2ZjYyLjEyLjEwMAEAAAAdAAAAZW5jb2Rlcj1MYXZjNjIuMjguMTAwIGxpYm9wdXNPZ2dTAAQYMAAAAAAAADJMXB4CAAAAgo+ioA1kPj1GRj87PUhIQEVQeIIsoDPhQh/HYAAAK4G1uvQN08jJyC+E50ZHgtK5bDG+6V8erAH+75TcNgelvrAD/7FIUMJNMD6lpPNjFhGJ7Xr3Q/iSBkq68rFVxuJ52hq7Wsl+VFiSOJsUBGtvNtGOwcPCpXib5tQMaJn8PYOu1/+KV3n/ZQ1Sv4XAz1qRM49ddShZ+Vbb/6O2/p84fIQEnmhD+KNqjkeUF4ZzoEAARWyfeJo3bzc3AQlWwaAc2WH168tlOPT5YYNYScRQ8lLD1mxlZAqlhiiM7jDqSsOihVjFMlraTkj4zGgy2WUvzHiaOp33X9L9UqsZBZJjDkTCnGM3y6DAzoO5RZhPPXs07BqCJLPwLc8/PGSJU5G3u66tZg2KzCrg7qnfLjs/uwKhuYaIvcx4mjqd91/S/VKqVT3GC3lD76CdwyxMsiRggEGKeW0+lKmh3L/HUV0OrveB+G4r5NdeWznDlZPRrO4/vH1ReloMF2YOgBFLeJm/Lzc3AQlWwaAfeeQ73hYPKAn+oM1Vb70wZFkTpYR+4pg5DGfPItnIQzr4/yurAq6V1JM4U9IHZpU9xW/MeJnCXlDyD8yaecGGvKSRYYMYlfgAeENwePEiFjlcP5V285UJ+oNvlgkMR7RpH5VzF4Z6hlrYAg6BAMx4mb8vNzcBCVbBoGUOGrAs8F67NtmrU+GNHThtVGPrpbm3LTpmnMQeG9yj/UFl/I+MaTkxTJa8aDLZZS/MeJnCXfdf0v1Sqy8Wj/KmmFh2Kse13Evi4tnA1fYg9HDryjSCr55oIQaIf2XKqjpbawlyC/UmGzrjcHdU75cXm5sCobmGiL1MaJnCXfdf0v1Sqmz2TgY9DudVwd1UNaRg38pG/kbbPJRr8uTfJ7y4A7R6Ztn0GotVTxLQRs6KBc99XIPz7rksAh/DLNv6BB0LaJm/Lzc3AQlWwZ+DiW1lYw4Zd5EOTLezTrY7gn0WpigksVVxYM/7Gb7IfcC9KNvheRy8vUEHuautSdmlT3FbzGiZwl4AAVvsmnx0IC5JVZyeh0Htj011ORCZ8g40wO6X5H5BSY4Rvc+qq7uvzXR8I0/Bz5eebpFMkoZR5QXhnOgQABFbDGiaVE6XF+X+OG0rYtS9/lHwsbBJR023dv1w8qv4MXAtoIgSYofURGr1WS67CudBo4+tVFUf1l0ZnD6ZkyNM8GGev4elhsi9HVK2hKWqYdet";

function streams(bytes: Uint8Array) {
  const result: Uint8Array[] = [];
  let start = 0,
    offset = 0;
  while (offset < bytes.length) {
    const segmentCount = bytes[offset + 26];
    const headerEnd = offset + 27 + segmentCount;
    const bodyBytes = bytes
      .subarray(offset + 27, headerEnd)
      .reduce((total, size) => total + size, 0);
    const flags = bytes[offset + 5];
    offset = headerEnd + bodyBytes;
    if (flags & 4) {
      result.push(bytes.slice(start, offset));
      start = offset;
    }
  }
  return result;
}

describe("Ogg Opus chaining", () => {
  it("rewrites each complete input as a separately valid logical stream", () => {
    const segments = [
      opusFixture(),
      Uint8Array.from(atob(opus880HzFixtureBase64), (c) => c.charCodeAt(0)),
    ];
    const chained = new Uint8Array(
      segments.reduce((total, segment) => total + segment.byteLength, 0),
    );
    let offset = 0;
    for (const [index, segment] of segments.entries())
      offset = appendOggOpusLink(chained, offset, segment, index + 1);
    expect(offset).toBe(chained.byteLength);
    const links = streams(chained);

    expect(links).toHaveLength(2);
    expect(links.map((link) => inspectOggOpus(link).durationSeconds)).toEqual(
      segments.map((segment) => inspectOggOpus(segment).durationSeconds),
    );
    const view = new DataView(
      chained.buffer,
      chained.byteOffset,
      chained.byteLength,
    );
    expect(view.getUint32(14, true)).not.toBe(
      view.getUint32(links[0].length + 14, true),
    );
  });

  it("appends validated links into one exact-size output buffer", () => {
    const segments = [opusFixture(), opusFixture()];
    const output = new Uint8Array(
      segments.reduce((total, segment) => total + segment.byteLength, 0),
    );
    let offset = 0;
    for (const [index, segment] of segments.entries())
      offset = appendOggOpusLink(output, offset, segment, index + 1);

    expect(offset).toBe(output.byteLength);
    expect(streams(output)).toHaveLength(2);
    expect(() =>
      appendOggOpusLink(
        new Uint8Array(segments[0].byteLength - 1),
        0,
        segments[0],
        1,
      ),
    ).toThrow("Ogg Opus output buffer is too small.");
  });

  it("accepts 121 complete links within the backend session limit", () => {
    const segment = opusFixture();
    const links = Array.from({ length: 121 }, () => segment);
    const chained = new Uint8Array(
      links.reduce((total, link) => total + link.byteLength, 0),
    );
    let offset = 0;
    for (const [index, link] of links.entries())
      offset = appendOggOpusLink(chained, offset, link, index + 1);

    expect(offset).toBe(chained.byteLength);
    expect(streams(chained)).toHaveLength(121);
    const serials = streams(chained).map((link) =>
      new DataView(link.buffer, link.byteOffset).getUint32(14, true),
    );
    expect(new Set(serials).size).toBe(121);
  });

  it("rejects incomplete or corrupt chunks before building a chain", () => {
    const corrupt = opusFixture();
    corrupt[corrupt.length - 1] ^= 1;
    const first = opusFixture();
    const output = new Uint8Array(first.byteLength + corrupt.byteLength);
    const offset = appendOggOpusLink(output, 0, first, 1);
    expect(() => appendOggOpusLink(output, offset, corrupt, 2)).toThrow(
      "Invalid bounded mono Ogg Opus sample.",
    );
  });
});
