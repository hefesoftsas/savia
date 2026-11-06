import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchTrustedMedia,
  localMediaInputArgs,
  parseTrustedMediaOrigins,
  probeVideo,
  validateTrustedMediaUrl,
} from "./server.mjs";

function isAvailable(binary) {
  return spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0;
}

function makeWav() {
  const sampleRate = 8000;
  const samples = Buffer.alloc(80);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

async function withMediaFixtures(run) {
  const dir = await mkdtemp(join(tmpdir(), "ffmpeg-local-input-test-"));
  const wavPath = join(dir, "direct.wav");
  const playlistPath = join(dir, "remote.m3u8");
  await writeFile(wavPath, makeWav());
  await writeFile(
    playlistPath,
    "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1.0,\nhttp://127.0.0.1:9/segment.ts\n#EXT-X-ENDLIST\n",
  );
  try {
    await run({ wavPath, playlistPath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function assertPlaylistRejected(binary, playlistPath, outputArgs) {
  const inputArgs = localMediaInputArgs(playlistPath);
  inputArgs.splice(inputArgs.indexOf("-i"), 0, "-f", "hls");
  const result = spawnSync(
    binary,
    ["-v", "debug", ...inputArgs, ...outputArgs],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0, `${binary} unexpectedly accepted HLS`);
  assert.match(result.stderr, /format not on whitelist/i);
}

describe("FFmpeg trusted media fetch", () => {
  const originalFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("fails closed when trusted media origins are missing or malformed", () => {
    assert.throws(
      () => parseTrustedMediaOrigins(undefined),
      /explicitly configured/,
    );
    assert.throws(
      () => parseTrustedMediaOrigins("https://media.example/private"),
      /must be HTTP\(S\) origins/,
    );
    assert.throws(
      () => parseTrustedMediaOrigins("https://user:pass@media.example"),
      /must be HTTP\(S\) origins/,
    );
  });

  it("allows only exact HTTP(S) origins, including the protocol and port", () => {
    const origins = parseTrustedMediaOrigins(
      "https://media.example, http://media.example:8080",
    );

    assert.equal(
      validateTrustedMediaUrl("https://media.example/path/file.mp4", origins)
        .href,
      "https://media.example/path/file.mp4",
    );
    assert.equal(
      validateTrustedMediaUrl("http://media.example:8080/file.png", origins)
        .href,
      "http://media.example:8080/file.png",
    );
    for (const value of [
      "http://media.example/file.mp4",
      "https://media.example.evil.test/file.mp4",
      "https://user@media.example/file.mp4",
      "https://media.example:8443/file.mp4",
      "file:///etc/passwd",
    ]) {
      assert.throws(() => validateTrustedMediaUrl(value, origins));
    }
  });

  it("forces redirect:error for every trusted media request", async () => {
    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return new Response("media", { status: 200 });
    };

    const response = await fetchTrustedMedia(
      "https://media.example/video.mp4",
      { headers: { Accept: "video/*" }, redirect: "follow" },
      "https://media.example",
    );

    assert.equal(await response.text(), "media");
    assert.equal(calls.length, 1);
    assert.ok(calls[0][0] instanceof URL);
    assert.equal(calls[0][0].href, "https://media.example/video.mp4");
    assert.equal(calls[0][1].redirect, "error");
    assert.equal(calls[0][1].headers.Accept, "video/*");
  });

  it("keeps encoded and protocol-relative-looking paths on the configured authority", async () => {
    let requestedUrl;
    globalThis.fetch = async (input) => {
      requestedUrl = input;
      return new Response("media", { status: 200 });
    };

    await fetchTrustedMedia(
      "https://media.example//evil.test/%2F%2Ffile.mp4?next=//evil.test",
      {},
      "https://media.example",
    );

    assert.ok(requestedUrl instanceof URL);
    assert.equal(requestedUrl.origin, "https://media.example");
    assert.equal(requestedUrl.pathname, "//evil.test/%2F%2Ffile.mp4");
    assert.equal(requestedUrl.search, "?next=//evil.test");
  });

  it("allows local direct-media inputs but blocks playlist and network protocols", () => {
    const args = localMediaInputArgs("/tmp/ffmpeg-jobs/job/input");
    const protocolIndex = args.indexOf("-protocol_whitelist");
    const formatIndex = args.indexOf("-format_whitelist");
    const protocols = args[protocolIndex + 1].split(",");
    const formats = args[formatIndex + 1].split(",");

    assert.deepEqual(protocols, ["file"]);
    assert.ok(formats.includes("mov"));
    assert.ok(formats.includes("matroska"));
    assert.ok(formats.includes("avi"));
    assert.ok(formats.includes("jpeg_pipe"));
    assert.ok(formats.includes("png_pipe"));
    for (const format of ["hls", "dash", "concat", "data"]) {
      assert.ok(!formats.includes(format), `${format} must not be accepted`);
    }
    for (const protocol of ["http", "https", "tcp", "udp", "data"]) {
      assert.ok(
        !protocols.includes(protocol),
        `${protocol} must not be accepted`,
      );
    }
    assert.deepEqual(args.slice(-2), ["-i", "/tmp/ffmpeg-jobs/job/input"]);
  });

  it(
    "probes every downloaded file when used as the concat array callback",
    { skip: !isAvailable("ffprobe") && "ffprobe is unavailable" },
    async () =>
      withMediaFixtures(async ({ wavPath }) => {
        const results = await Promise.all([wavPath, wavPath].map(probeVideo));
        assert.equal(results.length, 2);
        for (const result of results) {
          assert.ok(
            result.streams.some((stream) => stream.codec_type === "audio"),
          );
        }
      }),
  );

  it(
    "accepts a local WAV and rejects HLS before opening its remote segment with ffprobe",
    { skip: !isAvailable("ffprobe") && "ffprobe is unavailable" },
    async () =>
      withMediaFixtures(({ wavPath, playlistPath }) => {
        const direct = spawnSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_streams",
            "-of",
            "json",
            ...localMediaInputArgs(wavPath),
          ],
          { encoding: "utf8", timeout: 5000 },
        );
        assert.equal(direct.error, undefined, direct.error?.message);
        assert.equal(direct.status, 0, direct.stderr);
        assert.ok(
          JSON.parse(direct.stdout).streams.some(
            (stream) => stream.codec_type === "audio",
          ),
        );

        assertPlaylistRejected("ffprobe", playlistPath, ["-show_streams"]);
      }),
  );

  it(
    "accepts a local WAV and rejects HLS before opening its remote segment with ffmpeg",
    { skip: !isAvailable("ffmpeg") && "ffmpeg is unavailable" },
    async () =>
      withMediaFixtures(({ wavPath, playlistPath }) => {
        const direct = spawnSync(
          "ffmpeg",
          ["-v", "error", ...localMediaInputArgs(wavPath), "-f", "null", "-"],
          { encoding: "utf8", timeout: 5000 },
        );
        assert.equal(direct.error, undefined, direct.error?.message);
        assert.equal(direct.status, 0, direct.stderr);

        assertPlaylistRejected("ffmpeg", playlistPath, ["-f", "null", "-"]);
      }),
  );
});
