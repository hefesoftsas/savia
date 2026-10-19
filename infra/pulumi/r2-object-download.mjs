import https from "node:https";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertAccountId, assertSafeR2Key } from "./naming.mjs";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CONTENT_ENCODING_LENGTH = 1024;
const CONTENT_CODING_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Download an R2 object through Cloudflare's authenticated API without HTTP
 * content decoding. `https.request` exposes the response's stored bytes, so
 * Content-Encoding metadata such as br or gzip is preserved in the file.
 * `timeoutMs` bounds inactivity before headers and between response chunks;
 * any arriving chunk restarts the timer so large progressing downloads finish.
 */
export async function downloadR2Object({
  accountId,
  bucket,
  key,
  token,
  destFile,
  expectedSize,
  expectedEtag,
  contentEncoding,
  requestImpl = https.request,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const validatedAccountId = assertAccountId(accountId);
  if (
    typeof bucket !== "string" ||
    bucket.trim() === "" ||
    bucket !== bucket.trim() ||
    bucket.includes("/")
  ) {
    throw new Error("bucket must be a non-empty R2 bucket name");
  }
  const safeKey = assertSafeR2Key(key);
  if (
    typeof token !== "string" ||
    token.trim() === "" ||
    /[\r\n]/.test(token)
  ) {
    throw new Error("A valid Cloudflare API token is required");
  }
  if (typeof destFile !== "string" || destFile.trim() === "") {
    throw new Error("destFile must be a non-empty path");
  }
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
    throw new Error("expectedSize must be a non-negative safe integer");
  }
  const etag =
    typeof expectedEtag === "string"
      ? expectedEtag.replace(/^"|"$/g, "")
      : undefined;
  if (
    expectedEtag !== undefined &&
    (typeof etag !== "string" || !/^[^"\r\n]+$/.test(etag))
  )
    throw new Error("expectedEtag must be a valid R2 ETag");
  if (contentEncoding !== undefined && typeof contentEncoding !== "string") {
    throw new Error("contentEncoding must be a valid HTTP content-coding list");
  }
  let acceptEncoding = contentEncoding ?? "identity";
  if (acceptEncoding.length > MAX_CONTENT_ENCODING_LENGTH) {
    throw new Error(
      `contentEncoding must be at most ${MAX_CONTENT_ENCODING_LENGTH} characters`,
    );
  }
  acceptEncoding = acceptEncoding.replace(/^[ \t]+|[ \t]+$/g, "");
  if (acceptEncoding === "") {
    acceptEncoding = "identity";
  } else if (
    !acceptEncoding
      .split(",")
      .every((coding) =>
        CONTENT_CODING_TOKEN.test(coding.replace(/^[ \t]+|[ \t]+$/g, "")),
      )
  ) {
    throw new Error("contentEncoding must be a valid HTTP content-coding list");
  }
  if (
    typeof timeoutMs !== "number" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(`timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`);
  }
  if (typeof requestImpl !== "function") {
    throw new Error("requestImpl must be a function");
  }

  const encodedKey = safeKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const options = {
    protocol: "https:",
    hostname: "api.cloudflare.com",
    method: "GET",
    path: `/client/v4/accounts/${validatedAccountId}/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodedKey}`,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/octet-stream",
      // Match the object's stored metadata. Asking for multiple encodings can
      // make the edge transcode plaintext objects, invalidating byte checks.
      "accept-encoding": acceptEncoding,
      ...(etag ? { "if-match": `"${etag}"` } : {}),
    },
  };

  let request;
  let output;
  let responsePipeline;
  let requestFailure;
  let settled = false;
  let fileCreated = false;
  let bytesWritten = 0;
  let timeout;
  const resetInactivityTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      request?.destroy(
        new Error("R2 object request timed out after inactivity"),
      );
    }, timeoutMs);
  };
  resetInactivityTimeout();

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      const resolve = (value) => {
        if (settled) return;
        settled = true;
        resolvePromise(value);
      };
      const reject = (error) => {
        if (settled) return;
        settled = true;
        rejectPromise(error);
      };
      try {
        request = requestImpl(options, (response) => {
          if (settled || requestFailure) {
            response.destroy();
            return;
          }
          resetInactivityTimeout();
          if (response.statusCode !== 200) {
            response.destroy();
            reject(
              new Error(
                `R2 object download returned HTTP ${response.statusCode ?? "unknown"}`,
              ),
            );
            return;
          }
          if (etag && response.headers.etag !== `"${etag}"`) {
            response.destroy();
            reject(
              new Error("R2 object ETag does not match its recovery inventory"),
            );
            return;
          }

          const counter = new Transform({
            transform(chunk, _encoding, callback) {
              resetInactivityTimeout();
              bytesWritten += chunk.byteLength;
              if (bytesWritten > expectedSize) {
                callback(
                  new Error(
                    `R2 object exceeds expected size of ${expectedSize} bytes`,
                  ),
                );
                return;
              }
              callback(null, chunk);
            },
            flush(callback) {
              if (bytesWritten !== expectedSize) {
                callback(
                  new Error(
                    `R2 object size mismatch: received ${bytesWritten} bytes, expected ${expectedSize}`,
                  ),
                );
                return;
              }
              callback();
            },
          });
          output = createWriteStream(destFile, { flags: "wx", mode: 0o600 });
          output.once("open", () => {
            fileCreated = true;
          });
          responsePipeline = pipeline(response, counter, output);
          responsePipeline.then(
            () => resolve({ bytesWritten }),
            (error) => reject(requestFailure ?? error),
          );
        });
        request.once("error", (error) => {
          requestFailure ??= error;
          if (!responsePipeline) reject(error);
          // Once a response stream exists, pipeline closes all streams before
          // rejection lets the outer handler remove any partial file.
        });
        request.end();
      } catch (error) {
        reject(error);
      }
    });
    return { bytesWritten };
  } catch (error) {
    if (responsePipeline) await responsePipeline.catch(() => {});
    if (fileCreated) await rm(destFile, { force: true });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
