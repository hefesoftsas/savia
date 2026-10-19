import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { Readable } from "node:stream";
import test from "node:test";
import { downloadR2Object } from "./r2-object-download.mjs";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const BUCKET = "savia-backups-preview";
const TOKEN = "cloudflare-test-token";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "r2-object-download-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fakeRequest({
  statusCode = 200,
  headers = {},
  chunks = [],
  delayMs = 0,
  chunkDelayMs = 0,
}) {
  const seen = {};
  const requestImpl = (options, onResponse) => {
    seen.options = options;
    const request = new EventEmitter();
    let response;
    request.end = () => {
      if (delayMs < 0) return;
      setTimeout(() => {
        if (request.destroyed) return;
        response = Readable.from(
          chunkDelayMs
            ? (async function* () {
                for (const chunk of chunks) {
                  await new Promise((resolve) =>
                    setTimeout(resolve, chunkDelayMs),
                  );
                  yield chunk;
                }
              })()
            : chunks,
        );
        response.statusCode = statusCode;
        response.headers = headers;
        onResponse(response);
      }, delayMs);
    };
    request.destroy = (error) => {
      request.destroyed = true;
      response?.destroy(error);
      if (error) queueMicrotask(() => request.emit("error", error));
      return request;
    };
    return request;
  };
  return { requestImpl, seen };
}

test("pins each downloaded object to the listed ETag even when its byte size is unchanged", async () => {
  await withTempDir(async (dir) => {
    for (const etag of ['"original"', '"overwritten"', undefined]) {
      const destFile = join(dir, etag ? etag.replaceAll('"', "") : "missing");
      const { requestImpl, seen } = fakeRequest({
        headers: { etag },
        chunks: [Buffer.from("data")],
      });
      const operation = downloadR2Object({
        accountId: ACCOUNT_ID,
        bucket: BUCKET,
        key: "document",
        token: TOKEN,
        destFile,
        expectedSize: 4,
        expectedEtag: "original",
        requestImpl,
      });
      if (etag === '"original"') {
        await operation;
        assert.equal(seen.options.headers["if-match"], '"original"');
      } else {
        await assert.rejects(operation, /ETag/);
        await assert.rejects(stat(destFile));
      }
    }
  });
});

test("downloads compressed R2 bytes without HTTP content decoding", async () => {
  await withTempDir(async (dir) => {
    const original = Buffer.from("stored wasm-like payload ".repeat(50));
    for (const [encoding, bytes] of [
      ["br", brotliCompressSync(original)],
      ["gzip", gzipSync(original)],
    ]) {
      const destFile = join(dir, `object-${encoding}`);
      const { requestImpl, seen } = fakeRequest({
        headers: { "content-encoding": encoding },
        chunks: [bytes.subarray(0, 10), bytes.subarray(10)],
      });
      const result = await downloadR2Object({
        accountId: ACCOUNT_ID,
        bucket: BUCKET,
        key: "nested/a b+%.bin",
        token: TOKEN,
        destFile,
        expectedSize: bytes.byteLength,
        contentEncoding: encoding,
        requestImpl,
      });

      assert.equal(result.bytesWritten, bytes.byteLength);
      assert.deepEqual(await readFile(destFile), bytes);
      assert.equal((await stat(destFile)).mode & 0o777, 0o600);
      assert.equal(seen.options.protocol, "https:");
      assert.equal(seen.options.hostname, "api.cloudflare.com");
      assert.equal(seen.options.method, "GET");
      assert.equal(seen.options.headers["accept-encoding"], encoding);
      assert.equal(
        seen.options.path,
        `/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/nested/a%20b%2B%25.bin`,
      );
      assert.equal(seen.options.headers.authorization, `Bearer ${TOKEN}`);
    }
  });
});

test("requests identity encoding for plaintext objects by default", async () => {
  await withTempDir(async (dir) => {
    const bytes = Buffer.from("plain checkpoint payload");
    for (const [index, contentEncoding] of [undefined, "", " \t "].entries()) {
      const destFile = join(dir, `plain-${index}`);
      const { requestImpl, seen } = fakeRequest({ chunks: [bytes] });
      await downloadR2Object({
        accountId: ACCOUNT_ID,
        bucket: BUCKET,
        key: "checkpoint.json",
        token: TOKEN,
        destFile,
        expectedSize: bytes.byteLength,
        contentEncoding,
        requestImpl,
      });

      assert.equal(seen.options.headers["accept-encoding"], "identity");
      assert.deepEqual(await readFile(destFile), bytes);
    }
  });
});

test("preserves valid stored content-coding metadata exactly", async () => {
  await withTempDir(async (dir) => {
    for (const [index, contentEncoding] of [
      "zstd",
      "GZip",
      "gzip, br",
      "  gzip, br  ",
    ].entries()) {
      const destFile = join(dir, `encoded-${index}`);
      const { requestImpl, seen } = fakeRequest({ chunks: [Buffer.from("x")] });
      await downloadR2Object({
        accountId: ACCOUNT_ID,
        bucket: BUCKET,
        key: `encoded-${index}`,
        token: TOKEN,
        destFile,
        expectedSize: 1,
        contentEncoding,
        requestImpl,
      });
      assert.equal(
        seen.options.headers["accept-encoding"],
        contentEncoding.trim(),
      );
    }
  });
});

test("rejects short and oversized responses and removes partial files", async () => {
  await withTempDir(async (dir) => {
    for (const [name, chunks, expectedSize] of [
      ["short", [Buffer.from("short")], 10],
      ["long", [Buffer.from("longer than expected")], 4],
    ]) {
      const destFile = join(dir, name);
      const { requestImpl } = fakeRequest({ chunks });
      await assert.rejects(
        downloadR2Object({
          accountId: ACCOUNT_ID,
          bucket: BUCKET,
          key: `${name}.bin`,
          token: TOKEN,
          destFile,
          expectedSize,
          requestImpl,
        }),
        /size mismatch|exceeds expected size/i,
      );
      await assert.rejects(readFile(destFile), { code: "ENOENT" });
    }
  });
});

test("rejects non-200 responses without creating the destination", async () => {
  await withTempDir(async (dir) => {
    const destFile = join(dir, "missing-object");
    const { requestImpl } = fakeRequest({ statusCode: 404 });
    await assert.rejects(
      downloadR2Object({
        accountId: ACCOUNT_ID,
        bucket: BUCKET,
        key: "missing-object",
        token: TOKEN,
        destFile,
        expectedSize: 0,
        requestImpl,
      }),
      /HTTP 404/,
    );
    await assert.rejects(readFile(destFile), { code: "ENOENT" });
  });
});

test("times out when no response arrives before the inactivity deadline", async () => {
  await withTempDir(async (dir) => {
    const destFile = join(dir, "timeout");
    const { requestImpl } = fakeRequest({ delayMs: -1 });
    await assert.rejects(
      downloadR2Object({
        accountId: ACCOUNT_ID,
        bucket: BUCKET,
        key: "timeout",
        token: TOKEN,
        destFile,
        expectedSize: 0,
        requestImpl,
        timeoutMs: 10,
      }),
      /timed out/i,
    );
    await assert.rejects(readFile(destFile), { code: "ENOENT" });
  });
});

test("allows a download that makes steady progress beyond one idle interval", async () => {
  await withTempDir(async (dir) => {
    const destFile = join(dir, "slow-progress");
    const chunks = ["a", "b", "c", "d"].map((value) => Buffer.from(value));
    const { requestImpl } = fakeRequest({ chunks, chunkDelayMs: 150 });
    const result = await downloadR2Object({
      accountId: ACCOUNT_ID,
      bucket: BUCKET,
      key: "slow-progress",
      token: TOKEN,
      destFile,
      expectedSize: 4,
      requestImpl,
      timeoutMs: 500,
    });

    assert.equal(result.bytesWritten, 4);
    assert.equal(await readFile(destFile, "utf8"), "abcd");
  });
});

test("waits for an active response pipeline to close before removing partial output", async () => {
  await withTempDir(async (dir) => {
    const destFile = join(dir, "stream-timeout");
    const response = new PassThrough();
    response.statusCode = 200;
    response.headers = {};
    let responseClosed = false;
    response.once("close", () => {
      responseClosed = true;
    });
    const requestImpl = (_options, onResponse) => {
      const request = new EventEmitter();
      request.end = () => {
        onResponse(response);
        response.write(Buffer.from("partial"));
      };
      request.destroy = (error) => {
        queueMicrotask(() => request.emit("error", error));
        setTimeout(() => response.destroy(error), 25);
        return request;
      };
      return request;
    };

    await assert.rejects(
      downloadR2Object({
        accountId: ACCOUNT_ID,
        bucket: BUCKET,
        key: "stream-timeout",
        token: TOKEN,
        destFile,
        expectedSize: 100,
        requestImpl,
        timeoutMs: 20,
      }),
      /timed out/i,
    );
    assert.equal(responseClosed, true);
    await assert.rejects(readFile(destFile), { code: "ENOENT" });
  });
});

test("does not overwrite or delete an existing destination", async () => {
  await withTempDir(async (dir) => {
    const destFile = join(dir, "existing");
    await writeFile(destFile, "keep me");
    const { requestImpl } = fakeRequest({ chunks: [Buffer.from("replace")] });
    await assert.rejects(
      downloadR2Object({
        accountId: ACCOUNT_ID,
        bucket: BUCKET,
        key: "existing",
        token: TOKEN,
        destFile,
        expectedSize: 7,
        requestImpl,
      }),
      /exist/i,
    );
    assert.equal(await readFile(destFile, "utf8"), "keep me");
  });
});

test("validates credentials, key, destination, size, and timeout before I/O", async () => {
  let requests = 0;
  const requestImpl = () => {
    requests += 1;
    throw new Error("request must not start");
  };
  const valid = {
    accountId: ACCOUNT_ID,
    bucket: BUCKET,
    key: "object.bin",
    token: TOKEN,
    destFile: "/tmp/object.bin",
    expectedSize: 1,
    requestImpl,
  };
  for (const [override, pattern] of [
    [{ accountId: "bad" }, /accountId/],
    [{ bucket: "" }, /bucket/],
    [{ key: "../outside" }, /unsafe R2 key/],
    [{ token: "" }, /token/],
    [{ destFile: "" }, /destFile/],
    [{ expectedSize: -1 }, /expectedSize/],
    [{ expectedSize: Number.MAX_SAFE_INTEGER + 1 }, /expectedSize/],
    [{ timeoutMs: 0 }, /timeoutMs/],
    [{ contentEncoding: "gzip\r\nX-Injected: yes" }, /contentEncoding/],
    [{ contentEncoding: "gzip,,br" }, /contentEncoding/],
    [{ contentEncoding: "gzip; q=0.5" }, /contentEncoding/],
    [{ contentEncoding: 42 }, /contentEncoding/],
    [{ contentEncoding: null }, /contentEncoding/],
    [{ contentEncoding: `gzip, ${"a".repeat(1020)}` }, /contentEncoding/],
  ]) {
    await assert.rejects(downloadR2Object({ ...valid, ...override }), pattern);
  }
  assert.equal(requests, 0);
});
