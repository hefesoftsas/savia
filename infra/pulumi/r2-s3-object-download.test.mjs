import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createR2S3Downloader,
  resolveR2S3Credentials,
} from "./r2-s3-object-download.mjs";

const ACCOUNT = "08a0d36f8b0357684f83e4bfeb6628b6";
const TOKEN = "private-cloudflare-token";

function response(status, result) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => result,
  };
}

function verifyPayload(id = ACCOUNT, status = "active") {
  return { success: true, result: { id, status } };
}

test("resolves active account token identity and derives the S3 secret", async () => {
  const calls = [];
  const credentials = await resolveR2S3Credentials({
    accountId: ACCOUNT,
    token: TOKEN,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return response(200, verifyPayload());
    },
  });

  assert.deepEqual(credentials, {
    accessKeyId: ACCOUNT,
    secretAccessKey: createHash("sha256").update(TOKEN).digest("hex"),
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /accounts\/[a-f0-9]{32}\/tokens\/verify$/);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
});

test("falls back to user token verification only on account-scope rejection", async () => {
  const calls = [];
  const credentials = await resolveR2S3Credentials({
    accountId: ACCOUNT,
    token: TOKEN,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? response(403, { success: false })
        : response(200, verifyPayload());
    },
  });
  assert.equal(credentials.accessKeyId, ACCOUNT);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /user\/tokens\/verify$/);
});

test("fails closed for inactive, malformed, and unverifiable tokens", async (t) => {
  for (const [name, fetchImpl] of [
    [
      "inactive token",
      async () => response(200, verifyPayload(ACCOUNT, "disabled")),
    ],
    [
      "malformed identity",
      async () => response(200, verifyPayload("not-an-id")),
    ],
    ["rate limited account verification", async () => response(429, {})],
    [
      "network failure",
      async () => {
        throw new Error("private transport detail");
      },
    ],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        resolveR2S3Credentials({ accountId: ACCOUNT, token: TOKEN, fetchImpl }),
        (error) =>
          !error.message.includes("private") && error.message.length < 180,
      );
    });
  }
});

test("uses isolated source credentials, exact conditional S3 request, and preserves bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "r2-s3-download-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, "stored.gz");
  const bytes = Buffer.from([0x1f, 0x8b, 0x00, 0xff, 0x80]);
  const observed = [];
  const downloader = createR2S3Downloader({
    accountId: ACCOUNT,
    token: TOKEN,
    parentEnv: {
      PATH: "/usr/bin",
      AWS_ACCESS_KEY_ID: "pulumi-state-key",
      AWS_SECRET_ACCESS_KEY: "pulumi-state-secret",
      AWS_SESSION_TOKEN: "state-session",
      AWS_PROFILE: "production-state",
      AWS_ENDPOINT_URL: "https://wrong.example",
      GITHUB_TOKEN: "github-secret",
    },
    fetchImpl: async () => response(200, verifyPayload()),
    execFileImpl: async (command, args, options) => {
      observed.push({
        command,
        args,
        env: options.env,
        timeout: options.timeout,
        key: await readFile(args[5].slice("file://".length), "utf8"),
      });
      await writeFile(args[args.indexOf("--if-match") + 2], bytes);
      return {
        stdout: JSON.stringify({
          ETag: '"opaque-tag-4-2"',
          ContentLength: bytes.length,
        }),
        stderr: "",
      };
    },
  });

  await downloader({
    bucket: "savia-documents",
    key: "archive/blob.gz",
    destFile: destination,
    expectedSize: bytes.length,
    expectedEtag: "opaque-tag-4-2",
  });

  assert.equal(observed.length, 1);
  assert.equal(observed[0].command, "aws");
  assert.equal(observed[0].args[0], "s3api");
  assert.equal(observed[0].args[1], "get-object");
  assert.deepEqual(observed[0].args.slice(2, 8), [
    "--bucket",
    "savia-documents",
    "--key",
    observed[0].args[5],
    "--if-match",
    '"opaque-tag-4-2"',
  ]);
  assert.match(observed[0].args[5], /^file:\/\/.*\/key$/);
  assert.equal(observed[0].key, "archive/blob.gz");
  assert.equal(observed[0].args[9], "--endpoint-url");
  assert.equal(
    observed[0].args[10],
    `https://${ACCOUNT}.r2.cloudflarestorage.com`,
  );
  assert.deepEqual(observed[0].args.slice(11, 15), [
    "--cli-connect-timeout",
    "30",
    "--cli-read-timeout",
    "300",
  ]);
  assert.equal(observed[0].args.at(-2), "--output");
  assert.equal(observed[0].args.at(-1), "json");
  assert.equal(observed[0].timeout, undefined);
  const childEnv = observed[0].env;
  assert.equal(childEnv.AWS_ACCESS_KEY_ID, ACCOUNT);
  assert.equal(
    childEnv.AWS_SECRET_ACCESS_KEY,
    createHash("sha256").update(TOKEN).digest("hex"),
  );
  assert.equal(childEnv.AWS_DEFAULT_REGION, "auto");
  for (const name of [
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_ENDPOINT_URL",
    "GITHUB_TOKEN",
  ]) {
    assert.equal(Object.hasOwn(childEnv, name), false);
  }
  assert.equal(
    Object.values(childEnv).some((value) => value === TOKEN),
    false,
  );
  assert.deepEqual(await readFile(destination), bytes);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
});

test("passes leading-dash and file-scheme keys as literal file contents", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "r2-s3-key-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const seenKeys = [];
  const downloader = createR2S3Downloader({
    accountId: ACCOUNT,
    token: TOKEN,
    fetchImpl: async () => response(200, verifyPayload()),
    execFileImpl: async (_command, args) => {
      const keyFile = args[args.indexOf("--key") + 1].slice("file://".length);
      seenKeys.push(await readFile(keyFile, "utf8"));
      await writeFile(args[args.indexOf("--if-match") + 2], "x");
      return {
        stdout: JSON.stringify({ ETag: '"tag"', ContentLength: 1 }),
        stderr: "",
      };
    },
  });
  for (const [index, key] of [
    "--leading-option",
    "file://private/object",
  ].entries()) {
    await downloader({
      bucket: "bucket",
      key,
      destFile: join(root, `out-${index}`),
      expectedSize: 1,
      expectedEtag: "tag",
    });
  }
  assert.deepEqual(seenKeys, ["--leading-option", "file://private/object"]);
});

test("AWS CLI parses file-scheme source keys literally without a remote request", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "r2-s3-cli-parser-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keyFile = join(root, "key");
  const outputFile = join(root, "object");
  await writeFile(keyFile, "file://literal-source-key", { mode: 0o600 });
  const result = spawnSync(
    "aws",
    [
      "s3api",
      "get-object",
      "--bucket",
      "parser-smoke",
      "--key",
      `file://${keyFile}`,
      "--if-match",
      '"parser-tag"',
      outputFile,
      "--endpoint-url",
      "http://127.0.0.1:1",
      "--cli-connect-timeout",
      "1",
      "--cli-read-timeout",
      "1",
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        PATH: process.env.PATH,
        AWS_ACCESS_KEY_ID: "offline-smoke",
        AWS_SECRET_ACCESS_KEY: "offline-smoke",
        AWS_DEFAULT_REGION: "auto",
        AWS_EC2_METADATA_DISABLED: "true",
        AWS_CONFIG_FILE: "/dev/null",
        AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
        AWS_PAGER: "",
        AWS_MAX_ATTEMPTS: "1",
      },
    },
  );
  if (result.error?.code === "ENOENT") {
    t.skip(
      "AWS CLI is unavailable; unit tests still verify safe key-file arguments",
    );
    return;
  }
  assert.equal(result.error?.code, undefined);
  assert.notEqual(result.status, 0);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.doesNotMatch(output, /parameter file|literal-source-key.*not found/i);
  assert.match(output, /connect|connection|endpoint/i);
});

test("shares token verification across downloads and rejects a wrong returned ETag", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "r2-s3-download-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let verifyCalls = 0;
  const tempFiles = [];
  const downloader = createR2S3Downloader({
    accountId: ACCOUNT,
    token: TOKEN,
    fetchImpl: async () => {
      verifyCalls += 1;
      return response(200, verifyPayload());
    },
    execFileImpl: async (_command, args) => {
      const output = args[args.indexOf("--if-match") + 2];
      tempFiles.push(output);
      await writeFile(output, "content");
      return {
        stdout: JSON.stringify({ ETag: '"different"', ContentLength: 7 }),
        stderr: "",
      };
    },
  });
  for (const name of ["one", "two"]) {
    await assert.rejects(
      downloader({
        bucket: "bucket",
        key: name,
        destFile: join(root, name),
        expectedSize: 7,
        expectedEtag: "listed",
      }),
    );
  }
  assert.equal(verifyCalls, 1);
  assert.equal(tempFiles.length, 2);
  for (const path of tempFiles)
    await assert.rejects(stat(path), { code: "ENOENT" });
});

test("rejects size mismatch, classifies precondition failure, cleans partials, and never overwrites", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "r2-s3-download-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputPaths = [];
  const downloader = createR2S3Downloader({
    accountId: ACCOUNT,
    token: TOKEN,
    fetchImpl: async () => response(200, verifyPayload()),
    execFileImpl: async (_command, args) => {
      const key = await readFile(
        args[args.indexOf("--key") + 1].slice("file://".length),
        "utf8",
      );
      const output = args[args.indexOf("--if-match") + 2];
      outputPaths.push(output);
      if (key === "precondition") {
        await writeFile(output, "partial");
        const error = new Error("private AWS body");
        error.stderr = "PreconditionFailed: HTTP 412 private AWS body";
        error.statusCode = 412;
        throw error;
      }
      await writeFile(output, "wrong");
      const length = key === "overwrite" ? 5 : 4;
      return {
        stdout: JSON.stringify({ ETag: '"listed"', ContentLength: length }),
        stderr: "",
      };
    },
  });
  await assert.rejects(
    downloader({
      bucket: "bucket",
      key: "precondition",
      destFile: join(root, "412"),
      expectedSize: 7,
      expectedEtag: "listed",
    }),
    (error) =>
      error.code === "RECOVERY_CONSISTENCY_DRIFT" &&
      !error.message.includes("private"),
  );
  await assert.rejects(
    downloader({
      bucket: "bucket",
      key: "size",
      destFile: join(root, "size"),
      expectedSize: 7,
      expectedEtag: "listed",
    }),
  );
  const existing = join(root, "existing");
  await writeFile(existing, "keep");
  await assert.rejects(
    downloader({
      bucket: "bucket",
      key: "overwrite",
      destFile: existing,
      expectedSize: 5,
      expectedEtag: "listed",
    }),
  );
  assert.equal(await readFile(existing, "utf8"), "keep");
  for (const path of outputPaths)
    await assert.rejects(stat(path), { code: "ENOENT" });
});
