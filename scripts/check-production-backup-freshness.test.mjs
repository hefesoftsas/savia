import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkProductionBackupFreshness,
  runFreshnessCheck,
} from "./check-production-backup-freshness.mjs";

const now = new Date("2026-10-17T12:00:00.000Z");
const bytes = Buffer.concat([Buffer.from("SAVIAFB1"), Buffer.alloc(64, 0x5a)]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const sourceSha = "c".repeat(40);
const objectKey = "production/daily-18-1.enc";
const markerKey = `${objectKey}.commit.json`;
const objectMetadata = {
  sha256,
  "source-sha": sourceSha,
  environment: "production",
  "run-id": "18",
  "run-attempt": "1",
  kind: "daily",
  verified: "true",
};
const marker = {
  version: 1,
  objectKey,
  kind: "daily",
  environment: "production",
  runId: "18",
  runAttempt: "1",
  sourceSha,
  sha256,
  sizeBytes: bytes.length,
  createdAt: "2026-10-17T02:00:00.000Z",
};
const markerBytes = Buffer.from(JSON.stringify(marker));
function markerRecord(value) {
  const body = Buffer.from(JSON.stringify(value));
  return {
    body,
    metadata: {
      environment: "production",
      kind: "daily",
      "run-id": "18",
      "run-attempt": "1",
      "marker-sha256": createHash("sha256").update(body).digest("hex"),
      verified: "true",
    },
  };
}
const markerMetadata = markerRecord(marker).metadata;

const ENV = {
  R2_BACKUP_ACCESS_KEY_ID: "dedicated-access-key",
  R2_BACKUP_SECRET_ACCESS_KEY: "dedicated-secret-key",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  SAVIA_BACKUP_BUCKET: "savia-production-backups",
  SAVIA_BACKUP_ENVIRONMENT: "production",
  PATH: "/usr/bin",
  GITHUB_TOKEN: "must-not-be-used",
};

function value(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function r2Fixture({
  pages,
  objects = new Map([
    [
      objectKey,
      {
        body: bytes,
        metadata: objectMetadata,
        lastModified: "2026-10-17T02:00:00.000Z",
      },
    ],
    [
      markerKey,
      {
        body: markerBytes,
        metadata: markerMetadata,
        lastModified: "2026-10-17T02:01:00.000Z",
      },
    ],
  ]),
  error = undefined,
} = {}) {
  const calls = [];
  const downloadPaths = [];
  const execFileImpl = async (file, args, options) => {
    calls.push({ file, args: [...args], options });
    assert.equal(file, "aws");
    assert.equal(args[0], "s3api");
    assert.equal(options.env.AWS_ACCESS_KEY_ID, ENV.R2_BACKUP_ACCESS_KEY_ID);
    assert.equal(
      options.env.AWS_SECRET_ACCESS_KEY,
      ENV.R2_BACKUP_SECRET_ACCESS_KEY,
    );
    assert.equal(options.env.AWS_DEFAULT_REGION, "auto");
    assert.equal(options.env.AWS_PAGER, "");
    assert.equal(options.env.AWS_PROFILE, undefined);
    assert.equal(options.env.GITHUB_TOKEN, undefined);
    assert.equal(options.env.AWS_CONFIG_FILE, "/dev/null");
    assert.equal(options.env.AWS_SHARED_CREDENTIALS_FILE, "/dev/null");
    assert.equal(value(args, "--bucket"), ENV.SAVIA_BACKUP_BUCKET);
    assert.equal(
      value(args, "--endpoint-url"),
      `https://${ENV.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    );
    if (error) throw new Error(error);
    const operation = args[1];
    if (operation === "list-objects-v2") {
      const continuationToken = value(args, "--continuation-token");
      assert.equal(value(args, "--prefix"), "production/daily-");
      assert.equal(value(args, "--max-keys"), "1000");
      const page = pages?.[continuationToken ?? "first"] ?? {
        IsTruncated: false,
        Contents: [
          {
            Key: markerKey,
            Size: markerBytes.length,
            LastModified: "2026-10-17T02:01:00.000Z",
          },
        ],
      };
      return { stdout: JSON.stringify(page), stderr: "" };
    }
    const key = value(args, "--key");
    const object = objects.get(key);
    if (!object) throw new Error("NoSuchKey");
    if (operation === "head-object") {
      return {
        stdout: JSON.stringify({
          ContentLength: object.body.length,
          Metadata: object.metadata,
          LastModified: object.lastModified,
        }),
        stderr: "",
      };
    }
    if (operation === "get-object") {
      downloadPaths.push(args[6]);
      await writeFile(args[6], object.body, { mode: 0o600 });
      return { stdout: "{}", stderr: "" };
    }
    throw new Error(`Unexpected AWS operation ${operation}`);
  };
  return { calls, downloadPaths, execFileImpl };
}

test("accepts a recent verified daily commit marker from R2 without GitHub API calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "backup-freshness-r2-"));
  const summaryPath = join(root, "summary.md");
  const r2 = r2Fixture();
  try {
    const result = await checkProductionBackupFreshness({
      env: ENV,
      now,
      execFileImpl: r2.execFileImpl,
      summaryPath,
    });
    assert.equal(result.fresh, true);
    assert.equal(result.newest.runId, "18");
    assert.equal(result.newest.key, objectKey);
    assert.equal(result.newest.markerKey, markerKey);
    assert.equal(
      r2.calls.filter(({ args }) => args[1] === "list-objects-v2").length,
      1,
    );
    assert.ok(
      r2.calls.some(
        ({ args }) =>
          args[1] === "head-object" && value(args, "--key") === objectKey,
      ),
    );
    assert.ok(r2.calls.every(({ file }) => file === "aws"));
    assert.match(
      await readFile(summaryPath, "utf8"),
      /Latest verified R2 production backup is 10\.0 hours old/,
    );
    assert.doesNotMatch(await readFile(summaryPath, "utf8"), /GitHub/);
    for (const path of r2.downloadPaths)
      await assert.rejects(readFile(path), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("paginates every production daily marker using explicit continuation tokens", async () => {
  const pages = {
    first: {
      IsTruncated: true,
      NextContinuationToken: "page-two",
      Contents: [],
    },
    "page-two": {
      IsTruncated: false,
      Contents: [
        {
          Key: markerKey,
          Size: markerBytes.length,
          LastModified: "2026-10-17T02:01:00.000Z",
        },
      ],
    },
  };
  const r2 = r2Fixture({ pages });
  const result = await checkProductionBackupFreshness({
    env: ENV,
    now,
    execFileImpl: r2.execFileImpl,
    summaryPath: null,
  });
  assert.equal(result.fresh, true);
  const lists = r2.calls.filter(({ args }) => args[1] === "list-objects-v2");
  assert.equal(lists.length, 2);
  assert.equal(value(lists[0].args, "--continuation-token"), undefined);
  assert.equal(value(lists[1].args, "--continuation-token"), "page-two");
  assert.ok(lists.every(({ args }) => args.includes("--no-paginate")));
});

test("treats an omitted IsTruncated in an empty S3-compatible listing as the final page", async () => {
  const r2 = r2Fixture({ pages: { first: { Contents: [] } } });
  const result = await checkProductionBackupFreshness({
    env: ENV,
    now,
    execFileImpl: r2.execFileImpl,
    summaryPath: null,
  });
  assert.equal(result.fresh, false);
  assert.equal(result.newest, null);
  assert.equal(
    r2.calls.filter(({ args }) => args[1] === "list-objects-v2").length,
    1,
  );
});

test("rejects stale or future commit/object timestamps and an empty marker list", async () => {
  const staleMarker = markerRecord({
    ...marker,
    createdAt: "2026-10-15T23:00:00.000Z",
  });
  const staleObjects = new Map([
    [
      objectKey,
      {
        body: bytes,
        metadata: objectMetadata,
        lastModified: "2026-10-15T23:00:00.000Z",
      },
    ],
    [
      markerKey,
      {
        ...staleMarker,
        lastModified: "2026-10-15T23:01:00.000Z",
      },
    ],
  ]);
  const stale = await checkProductionBackupFreshness({
    env: ENV,
    now,
    execFileImpl: r2Fixture({ objects: staleObjects }).execFileImpl,
    summaryPath: null,
  });
  assert.equal(stale.fresh, false);

  const futureMarker = markerRecord({
    ...marker,
    createdAt: "2026-10-17T13:00:00.000Z",
  });
  const futureObjects = new Map([
    [
      objectKey,
      {
        body: bytes,
        metadata: objectMetadata,
        lastModified: "2026-10-17T13:00:00.000Z",
      },
    ],
    [
      markerKey,
      {
        ...futureMarker,
        lastModified: "2026-10-17T13:01:00.000Z",
      },
    ],
  ]);
  await assert.rejects(
    checkProductionBackupFreshness({
      env: ENV,
      now,
      execFileImpl: r2Fixture({ objects: futureObjects }).execFileImpl,
      summaryPath: null,
    }),
    /invalid R2 object timestamp/,
  );

  const empty = await checkProductionBackupFreshness({
    env: ENV,
    now,
    execFileImpl: r2Fixture({
      pages: { first: { IsTruncated: false, Contents: [] } },
    }).execFileImpl,
    summaryPath: null,
  });
  assert.equal(empty.fresh, false);
  assert.equal(empty.newest, null);
});

test("rejects malformed, mismatched, incomplete, or uncommitted records", async () => {
  const badMarker = { ...marker, objectKey: "production/daily-19-1.enc" };
  const badMarkerMap = new Map([
    [
      objectKey,
      {
        body: bytes,
        metadata: objectMetadata,
        lastModified: "2026-10-17T02:00:00.000Z",
      },
    ],
    [
      markerKey,
      {
        body: Buffer.from(JSON.stringify(badMarker)),
        metadata: markerMetadata,
        lastModified: "2026-10-17T02:01:00.000Z",
      },
    ],
  ]);
  await assert.rejects(
    checkProductionBackupFreshness({
      env: ENV,
      now,
      execFileImpl: r2Fixture({ objects: badMarkerMap }).execFileImpl,
      summaryPath: null,
    }),
    /R2 backup marker does not match its key/,
  );

  const wrongMetadata = { ...objectMetadata, sha256: "0".repeat(64) };
  const wrongMetadataMap = new Map([
    [
      objectKey,
      {
        body: bytes,
        metadata: wrongMetadata,
        lastModified: "2026-10-17T02:00:00.000Z",
      },
    ],
    [
      markerKey,
      {
        body: markerBytes,
        metadata: markerMetadata,
        lastModified: "2026-10-17T02:01:00.000Z",
      },
    ],
  ]);
  await assert.rejects(
    checkProductionBackupFreshness({
      env: ENV,
      now,
      execFileImpl: r2Fixture({ objects: wrongMetadataMap }).execFileImpl,
      summaryPath: null,
    }),
    /R2 backup metadata does not match its commit marker/,
  );

  const missingObject = new Map([
    [
      markerKey,
      {
        body: markerBytes,
        metadata: markerMetadata,
        lastModified: "2026-10-17T02:01:00.000Z",
      },
    ],
  ]);
  await assert.rejects(
    checkProductionBackupFreshness({
      env: ENV,
      now,
      execFileImpl: r2Fixture({ objects: missingObject }).execFileImpl,
      summaryPath: null,
    }),
    /R2 provider operation failed/,
  );

  const uncommitted = await checkProductionBackupFreshness({
    env: ENV,
    now,
    execFileImpl: r2Fixture({
      pages: {
        first: {
          IsTruncated: false,
          Contents: [
            {
              Key: objectKey,
              Size: bytes.length,
              LastModified: "2026-10-17T02:00:00.000Z",
            },
          ],
        },
      },
    }).execFileImpl,
    summaryPath: null,
  });
  assert.equal(uncommitted.fresh, false);
});

test("fails closed on invalid pagination tokens and hidden provider errors", async () => {
  const repeating = r2Fixture({
    pages: {
      first: { IsTruncated: true, NextContinuationToken: "loop", Contents: [] },
      loop: { IsTruncated: true, NextContinuationToken: "loop", Contents: [] },
    },
  });
  await assert.rejects(
    checkProductionBackupFreshness({
      env: ENV,
      now,
      execFileImpl: repeating.execFileImpl,
      summaryPath: null,
    }),
    /invalid R2 pagination/,
  );

  const root = await mkdtemp(join(tmpdir(), "backup-freshness-r2-denied-"));
  const summaryPath = join(root, "summary.md");
  try {
    await assert.rejects(
      runFreshnessCheck({
        env: ENV,
        summaryPath,
        execFileImpl: r2Fixture({ error: "secret provider response payload" })
          .execFileImpl,
      }),
      (error) => {
        assert.match(error.message, /could not be verified/);
        assert.doesNotMatch(error.message, /secret provider response/);
        return true;
      },
    );
    const summary = await readFile(summaryPath, "utf8");
    assert.match(summary, /Could not verify retained R2 backup status/);
    assert.doesNotMatch(summary, /secret provider response/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires the exact production bucket and environment", async () => {
  for (const env of [
    { ...ENV, SAVIA_BACKUP_BUCKET: "other" },
    { ...ENV, SAVIA_BACKUP_ENVIRONMENT: "preview" },
  ]) {
    await assert.rejects(
      checkProductionBackupFreshness({
        env,
        now,
        execFileImpl: async () => {
          throw new Error("must not invoke AWS CLI");
        },
        summaryPath: null,
      }),
      /production/,
    );
  }
});
