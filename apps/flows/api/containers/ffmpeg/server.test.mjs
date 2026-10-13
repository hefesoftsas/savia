import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  fetchTrustedMedia,
  parseTrustedMediaOrigins,
  validateTrustedMediaUrl,
} from "./server.mjs";

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
      validateTrustedMediaUrl("https://media.example/path/file.mp4", origins),
      "https://media.example/path/file.mp4",
    );
    assert.equal(
      validateTrustedMediaUrl("http://media.example:8080/file.png", origins),
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
    assert.equal(calls[0][0], "https://media.example/video.mp4");
    assert.equal(calls[0][1].redirect, "error");
    assert.equal(calls[0][1].headers.Accept, "video/*");
  });
});
