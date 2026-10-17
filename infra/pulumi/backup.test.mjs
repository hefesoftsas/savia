import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseBackupArgs,
  createBackup,
  buildD1ExportCommand,
  buildR2SyncCommand,
  buildR2ObjectGetCommand,
  buildR2ObjectPutCommand,
  hasS3Credentials,
  manifestFor,
  listR2Objects,
  assertSafeTableDumpFallback,
  backupRelativePath,
  d1BackupTargets,
  flowsBucketTargets,
  hashBackupFiles,
  downloadR2Objects,
} from "./backup.mjs";
import { resolveInfraNames } from "./naming.mjs";

describe("pulumi backup", () => {
  it("parses args and requires --apply to write", () => {
    assert.throws(() => parseBackupArgs(["--stack", "preview"]));
    const dry = parseBackupArgs(["--stack", "preview", "--dry-run"]);
    assert.equal(dry.stack, "preview");
    assert.equal(dry.skipR2, false);
    assert.equal(dry.r2Concurrency, 4);
    assert.equal(
      parseBackupArgs([
        "--stack",
        "preview",
        "--dry-run",
        "--r2-concurrency",
        "7",
      ]).r2Concurrency,
      7,
    );
    for (const boundary of ["1", "8"]) {
      assert.equal(
        parseBackupArgs([
          "--stack",
          "preview",
          "--dry-run",
          "--r2-concurrency",
          boundary,
        ]).r2Concurrency,
        Number(boundary),
      );
    }
    const skip = parseBackupArgs([
      "--stack",
      "production",
      "--apply",
      "--skip-r2",
    ]);
    assert.equal(skip.skipR2, true);
    assert.equal(
      parseBackupArgs([
        "--stack",
        "preview",
        "--apply",
        "--confirm-quiescent",
        "preview",
      ]).confirmQuiescent,
      "preview",
    );
    assert.equal(
      parseBackupArgs([
        "--stack",
        "preview",
        "--apply",
        "--flows-snapshot",
        "/secure/flows-snapshot.json",
      ]).flowsSnapshot,
      "/secure/flows-snapshot.json",
    );
    assert.throws(
      () =>
        parseBackupArgs([
          "--stack",
          "preview",
          "--apply",
          "--flows-snapshot",
          "--confirm-quiescent",
          "preview",
        ]),
      /Missing required flag: --flows-snapshot/,
    );
  });

  it("rejects unknown stacks", () => {
    assert.throws(() => parseBackupArgs(["--stack", "qa", "--dry-run"]));
    assert.throws(() => parseBackupArgs(["--dry-run"]));
  });

  it("requires R2 concurrency to be an integer from 1 through 8", () => {
    for (const value of ["0", "9", "1.5", "fast"]) {
      assert.throws(
        () =>
          parseBackupArgs([
            "--stack",
            "preview",
            "--dry-run",
            "--r2-concurrency",
            value,
          ]),
        /--r2-concurrency must be an integer from 1 through 8/,
      );
    }
    assert.throws(
      () =>
        parseBackupArgs([
          "--stack",
          "preview",
          "--dry-run",
          "--r2-concurrency",
        ]),
      /--r2-concurrency must be an integer from 1 through 8/,
    );
  });

  it("downloads every listed object with bounded concurrency and nested paths", async () => {
    const destDir = await mkdtemp(join(tmpdir(), "backup-r2-pool-"));
    const objects = Array.from({ length: 11 }, (_, index) => ({
      key: index % 2 ? `nested/${index}.bin` : `${index}.bin`,
      size: index,
      etag: `etag-${index}`,
    }));
    let active = 0;
    let peak = 0;
    const downloaded = [];
    await downloadR2Objects({
      objects,
      destDir,
      bucket: "bucket",
      accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
      token: "redacted",
      concurrency: 3,
      downloadImpl: async ({ key, destFile, expectedSize }) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        await writeFile(destFile, String(expectedSize));
        downloaded.push(key);
        active--;
      },
    });
    assert.equal(peak, 3);
    assert.deepEqual(downloaded.sort(), objects.map(({ key }) => key).sort());
    for (const object of objects) {
      assert.equal(
        await readFile(join(destDir, object.key), "utf8"),
        String(object.size),
      );
    }
  });

  it("stops scheduling after an API object download fails and awaits active downloads", async () => {
    const destDir = await mkdtemp(join(tmpdir(), "backup-r2-failure-"));
    const objects = Array.from({ length: 8 }, (_, index) => ({
      key: `${index}.bin`,
      size: 1,
    }));
    const started = [];
    const finished = [];
    await assert.rejects(
      downloadR2Objects({
        objects,
        destDir,
        bucket: "bucket",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        token: "redacted",
        concurrency: 4,
        downloadImpl: async ({ key, destFile }) => {
          started.push(key);
          if (key === "0.bin") {
            await new Promise((resolve) => setTimeout(resolve, 5));
            throw new Error("download failed");
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
          await writeFile(destFile, "x");
          finished.push(key);
        },
      }),
      /download failed/,
    );
    assert.deepEqual(started.sort(), ["0.bin", "1.bin", "2.bin", "3.bin"]);
    assert.deepEqual(finished.sort(), ["1.bin", "2.bin", "3.bin"]);
  });

  it("stops scheduling even when a download rejects with a non-Error value", async () => {
    const destDir = await mkdtemp(join(tmpdir(), "backup-r2-reject-value-"));
    const started = [];
    await assert.rejects(
      downloadR2Objects({
        objects: Array.from({ length: 4 }, (_, index) => ({
          key: `${index}.bin`,
          size: 1,
        })),
        destDir,
        bucket: "bucket",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        token: "redacted",
        concurrency: 2,
        downloadImpl: async ({ key }) => {
          started.push(key);
          if (key === "0.bin") {
            await new Promise((resolve) => setTimeout(resolve, 5));
            throw null;
          }
          await new Promise((resolve) => setTimeout(resolve, 15));
        },
      }),
      (error) => error === null,
    );
    assert.deepEqual(started.sort(), ["0.bin", "1.bin"]);
  });

  it("builds wrangler D1 export commands", () => {
    const [command, args] = buildD1ExportCommand("savia-auth", "/out/a.sql");
    assert.equal(command, "pnpm");
    assert.ok(args.includes("d1"));
    assert.ok(args.includes("export"));
    assert.ok(args.includes("savia-auth"));
    assert.ok(args.includes("--remote"));
    assert.ok(args.includes("/out/a.sql"));
  });

  it("builds R2 sync commands against the account endpoint", () => {
    const accountId = "08a0d36f8b0357684f83e4bfeb6628b6";
    const [command, args] = buildR2SyncCommand({
      bucket: "savia-documents",
      destDir: "/out/r2",
      accountId,
    });
    assert.equal(command, "aws");
    assert.deepEqual(args.slice(0, 3), ["s3", "sync", "s3://savia-documents"]);
    assert.equal(
      args[args.indexOf("--endpoint-url") + 1],
      `https://${accountId}.r2.cloudflarestorage.com`,
    );
    assert.throws(() =>
      buildR2SyncCommand({
        bucket: "savia-documents",
        destDir: "/out/r2",
        accountId: "not-hex",
      }),
    );
  });

  it("builds a restore-ready manifest", () => {
    const manifest = manifestFor({
      stack: "preview",
      outputs: { documentsBucketName: "b" },
      files: { "savia-auth-preview": "d1/a.sql" },
      r2: null,
    });
    assert.equal(manifest.version, 2);
    assert.equal(manifest.stack, "preview");
    assert.ok(manifest.createdAt);
  });

  it("includes the exact optional Flows D1 and three preview R2 targets", () => {
    const disabled = {
      databaseNames: {
        auth: "savia-auth-preview",
        domain: "savia-agencies-preview",
      },
      authD1Id: "auth-id",
      domainD1Id: "domain-id",
      flowsEnabled: false,
      flowsResources: null,
    };
    assert.deepEqual(d1BackupTargets(disabled), {
      "savia-auth-preview": "auth-id",
      "savia-agencies-preview": "domain-id",
    });
    assert.deepEqual(flowsBucketTargets(disabled), {});

    const enabled = {
      ...disabled,
      flowsEnabled: true,
      plannedFlowsResourceNames: { database: "savia-flows-preview" },
      flowsResources: {
        databaseId: "flows-d1-id",
        buckets: {
          resources: "savia-flows-resources-preview",
          datasets: "savia-flows-datasets-preview",
          inboxes: "savia-flows-inboxes-preview",
        },
      },
    };
    assert.deepEqual(d1BackupTargets(enabled), {
      "savia-auth-preview": "auth-id",
      "savia-agencies-preview": "domain-id",
      "savia-flows-preview": "flows-d1-id",
    });
    assert.deepEqual(
      flowsBucketTargets(enabled),
      enabled.flowsResources.buckets,
    );
  });

  it("hashes every regular backup file using relative manifest paths", async () => {
    const base = await mkdtemp(join(tmpdir(), "backup-hashes-"));
    await mkdir(join(base, "d1"));
    await writeFile(join(base, "d1", "flows.sql"), "select 1;\n");
    const hashes = await hashBackupFiles(base);
    assert.equal(Object.keys(hashes).length, 1);
    assert.match(hashes["d1/flows.sql"], /^[a-f0-9]{64}$/);
  });

  it("requires explicit preview quiescence and verified production consistency", () => {
    assert.throws(
      () => assertSafeTableDumpFallback("preview", null),
      /confirm-quiescent/,
    );
    assert.doesNotThrow(() =>
      assertSafeTableDumpFallback("preview", "preview"),
    );
    assert.throws(
      () => assertSafeTableDumpFallback("production", "production"),
      /verified recovery boundary/i,
    );
    assert.doesNotThrow(() =>
      assertSafeTableDumpFallback("production", null, true),
    );
  });

  it("uses restore-supported schema dumps for both production D1 databases", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "backup-production-schema-dump-"),
    );
    const accountId = "a".repeat(32);
    const databases = {
      auth: {
        name: "savia-auth-local-canonical-20260913-v2",
        id: "11111111-1111-4111-8111-111111111111",
        table: "auth_records",
      },
      domain: {
        name: "savia-agencies-local-canonical-20260913-v2",
        id: "22222222-2222-4222-8222-222222222222",
        table: "domain_records",
      },
    };
    const names = resolveInfraNames({
      environment: "production",
      documentsBucket: "savia-documents",
      publicOrigin: "https://savia.app.hefesoft.com",
      authDatabaseName: databases.auth.name,
      domainDatabaseName: databases.domain.name,
    });
    const outputs = {
      cloudflareAccountId: accountId,
      authD1Id: databases.auth.id,
      domainD1Id: databases.domain.id,
      documentsBucketName: "savia-documents",
      resolvedEnvironment: "production",
      resolvedPublicOrigin: "https://savia.app.hefesoft.com",
      workerNames: names.workers,
      databaseNames: names.databases,
      plannedFlowsResourceNames: names.flows,
      flowsEnabled: false,
      flowsExecutionEnabled: false,
      flowsResources: null,
    };
    const commands = [];
    const fetchImpl = async (url, init = {}) => {
      const path = new URL(url).pathname;
      const match = /\/database\/([^/]+)(?:\/(.*))?$/.exec(path);
      assert.ok(match, `unexpected Cloudflare URL: ${url}`);
      const [, uuid, endpoint] = match;
      const db = Object.values(databases).find((value) => value.id === uuid);
      assert.ok(db, `unexpected D1 database ${uuid}`);
      if (!endpoint) {
        return Response.json({
          success: true,
          result: { uuid, name: db.name },
        });
      }
      if (endpoint === "time_travel/bookmark") {
        return Response.json({
          success: true,
          result: { uuid, name: db.name, bookmark: `bookmark-${uuid}` },
        });
      }
      assert.equal(endpoint, "query");
      const { sql } = JSON.parse(init.body);
      let results = [];
      if (sql.includes("type='table' AND substr(name,1,7) != 'sqlite_'")) {
        results = [{ name: db.table }];
      } else if (sql.includes("sql LIKE '%USING fts5%'")) {
        results = [];
      } else if (sql.includes("SELECT name, sql FROM sqlite_master")) {
        results = [
          {
            name: db.table,
            sql: `CREATE TABLE "${db.table}" ("id" INTEGER PRIMARY KEY)`,
          },
        ];
      } else if (
        sql.includes("SELECT type, name, sql, tbl_name FROM sqlite_master")
      ) {
        results = [];
      } else if (sql.startsWith("PRAGMA table_info")) {
        results = [{ name: "id" }];
      } else if (sql.startsWith("SELECT COUNT(*)")) {
        results = [{ c: 1 }];
      } else if (sql.startsWith('SELECT "id" FROM')) {
        results = sql.includes("OFFSET 0") ? [{ id: 1 }] : [];
      } else if (sql.includes("name = 'sqlite_sequence'")) {
        results = [];
      }
      return Response.json({
        success: true,
        result: [{ success: true, results }],
      });
    };

    const plan = {
      stack: "production",
      dryRun: false,
      skipR2: true,
      outDir: join(root, "capture"),
      confirmQuiescent: null,
      flowsSnapshot: null,
      r2Concurrency: 4,
    };
    const dependencies = {
      env: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: "token",
      },
      fetchImpl,
      run: async (command, args) => {
        commands.push([command, args]);
        assert.equal(
          command,
          "pulumi",
          "production must not use Wrangler export",
        );
        return { stdout: JSON.stringify(outputs), stderr: "" };
      },
    };
    let monitorStarts = 0;
    let monitorStopped = false;
    try {
      const manifest = await createBackup(plan, {
        ...dependencies,
        startMonitor(boundary, options) {
          monitorStarts++;
          assert.equal(boundary.d1[databases.auth.name].id, databases.auth.id);
          assert.equal(options.token, "token");
          return async () => {
            if (monitorStopped) return;
            monitorStopped = true;
            await assert.rejects(access(join(plan.outDir, "manifest.json")), {
              code: "ENOENT",
            });
          };
        },
      });
      assert.equal(monitorStarts, 1);
      assert.equal(monitorStopped, true);

      assert.deepEqual(manifest.d1Methods, {
        [databases.auth.name]: "schema-dump",
        [databases.domain.name]: "schema-dump",
      });
      assert.equal(commands.length, 1);
      for (const db of Object.values(databases)) {
        const sql = await readFile(
          join(root, "capture", "d1", `${db.name}.sql`),
          "utf8",
        );
        assert.match(sql, new RegExp(`CREATE TABLE \\"${db.table}\\"`));
        assert.match(sql, new RegExp(`INSERT INTO \\"${db.table}\\"`));
      }

      const failedPlan = { ...plan, outDir: join(root, "failed-monitor") };
      await assert.rejects(
        createBackup(failedPlan, {
          ...dependencies,
          startMonitor: () => async () => {
            throw new Error("Bookmark monitor failed");
          },
        }),
        /Bookmark monitor failed/,
      );
      await assert.rejects(access(join(failedPlan.outDir, "manifest.json")), {
        code: "ENOENT",
      });

      let failedCaptureStopped = false;
      const failedCapturePlan = { ...plan, outDir: join(root, "failed-query") };
      await assert.rejects(
        createBackup(failedCapturePlan, {
          ...dependencies,
          fetchImpl: async (url, init) => {
            if (String(url).endsWith("/query"))
              throw new Error("D1 transport failed");
            return fetchImpl(url, init);
          },
          startMonitor: () => async () => {
            failedCaptureStopped = true;
          },
        }),
        /D1 transport failed/,
      );
      assert.equal(failedCaptureStopped, true);
      await assert.rejects(
        access(join(failedCapturePlan.outDir, "manifest.json")),
        { code: "ENOENT" },
      );

      const previewNames = resolveInfraNames({
        environment: "preview",
        documentsBucket: "savia-documents-preview",
        publicOrigin: "https://savia-preview.hefesoft.com",
      });
      const previewOutputs = {
        ...outputs,
        resolvedEnvironment: "preview",
        resolvedPublicOrigin: "https://savia-preview.hefesoft.com",
        workerNames: previewNames.workers,
        databaseNames: previewNames.databases,
        documentsBucketName: previewNames.bucket,
        plannedFlowsResourceNames: previewNames.flows,
      };
      const previewManifest = await createBackup(
        { ...plan, stack: "preview", outDir: join(root, "preview") },
        {
          ...dependencies,
          fetchImpl: async () => {
            throw new Error("Preview native export must not query D1 metadata");
          },
          startMonitor: () => {
            throw new Error("Preview must not start the production monitor");
          },
          run: async (command, args) => {
            if (command === "pulumi")
              return { stdout: JSON.stringify(previewOutputs), stderr: "" };
            const outputIndex = args.indexOf("--output");
            assert.notEqual(outputIndex, -1);
            await writeFile(
              args[outputIndex + 1],
              "CREATE TABLE preview_records (id INTEGER PRIMARY KEY);\n",
            );
            return { stdout: "", stderr: "" };
          },
        },
      );
      assert.deepEqual(Object.values(previewManifest.d1Methods), [
        "export",
        "export",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps manifest paths relative to the backup directory", () => {
    assert.equal(
      backupRelativePath("/backup/run", "/backup/run/d1/auth.sql"),
      "d1/auth.sql",
    );
    assert.throws(
      () => backupRelativePath("/backup/run", "/other/auth.sql"),
      /inside the backup/,
    );
  });

  it("fails closed when the paginated R2 API fails or truncation has no cursor", async () => {
    await assert.rejects(
      listR2Objects({
        bucket: "bucket",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        token: "redacted",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            success: false,
            errors: [{ message: "denied" }],
          }),
        }),
      }),
      /R2 list failed/,
    );
    await assert.rejects(
      listR2Objects({
        bucket: "bucket",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        token: "redacted",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [],
            result_info: { is_truncated: true },
          }),
        }),
      }),
      /missing cursor/,
    );
  });

  it("retains all Cloudflare R2 object metadata from the API", async () => {
    const objects = await listR2Objects({
      bucket: "bucket",
      accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
      token: "redacted",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [
            {
              key: "a.txt",
              size: 3,
              etag: "etag",
              last_modified: "2026-10-12T00:00:00Z",
              ssec: false,
              storage_class: "Standard",
              http_metadata: {
                contentType: "text/plain",
                cacheControl: "no-cache",
              },
              custom_metadata: { owner: "savia" },
            },
          ],
          result_info: { is_truncated: false },
        }),
      }),
    });
    assert.deepEqual(objects[0], {
      key: "a.txt",
      size: 3,
      etag: "etag",
      lastModified: "2026-10-12T00:00:00Z",
      ssec: false,
      storageClass: "Standard",
      httpMetadata: { contentType: "text/plain", cacheControl: "no-cache" },
      customMetadata: { owner: "savia" },
    });
  });

  it("follows every R2 cursor and rejects a repeated pagination cursor", async () => {
    const urls = [];
    const objects = await listR2Objects({
      bucket: "bucket",
      accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
      token: "redacted",
      fetchImpl: async (url) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [{ key: `page-${urls.length}` }],
            result_info:
              urls.length === 1
                ? { is_truncated: true, cursor: "next" }
                : { is_truncated: false },
          }),
        };
      },
    });
    assert.deepEqual(
      objects.map(({ key }) => key),
      ["page-1", "page-2"],
    );
    assert.match(urls[1], /cursor=next/);

    await assert.rejects(
      listR2Objects({
        bucket: "bucket",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        token: "redacted",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [],
            result_info: { is_truncated: true, cursor: "same" },
          }),
        }),
      }),
      /repeated a pagination cursor/,
    );
  });

  it("preserves literal percent escapes and URL delimiters in Wrangler object keys", () => {
    const key = "plugin-editor/tenant%3A12/é #?.vsix";
    const encoded = "b/plugin-editor/tenant%253A12/%C3%A9%20%23%3F.vsix";
    const [, getArgs] = buildR2ObjectGetCommand({
      bucket: "b",
      key,
      destFile: "/out/package",
    });
    const [, putArgs] = buildR2ObjectPutCommand({
      bucket: "b",
      key,
      sourceFile: "/out/package",
      s3Credentials: false,
    });
    assert.ok(getArgs.includes(encoded));
    assert.ok(putArgs.includes(encoded));
  });

  it("builds per-object R2 get/put commands", () => {
    const [get, getArgs] = buildR2ObjectGetCommand({
      bucket: "b",
      key: "a/c.txt",
      destFile: "/out/a/c.txt",
    });
    assert.equal(get, "pnpm");
    assert.ok(getArgs.includes("get"));
    assert.ok(getArgs.includes("b/a/c.txt"));
    assert.ok(getArgs.includes("--remote"));
    assert.ok(getArgs.includes("/out/a/c.txt"));
    const [, putArgs] = buildR2ObjectPutCommand({
      bucket: "b",
      key: "a/c.txt",
      sourceFile: "/out/a/c.txt",
      httpMetadata: { contentType: "text/plain", cacheControl: "max-age=30" },
    });
    assert.ok(putArgs.includes("put"));
    assert.ok(putArgs.includes("b/a/c.txt"));
    assert.deepEqual(
      putArgs.slice(
        putArgs.indexOf("--content-type"),
        putArgs.indexOf("--content-type") + 2,
      ),
      ["--content-type", "text/plain"],
    );
    assert.ok(putArgs.includes("--cache-control"));
    const [, legacyPutArgs] = buildR2ObjectPutCommand({
      bucket: "b",
      key: "a/c.txt",
      sourceFile: "/out/a/c.txt",
      contentType: "text/plain",
      contentEncoding: "gzip",
    });
    assert.ok(legacyPutArgs.includes("--content-type"));
    assert.ok(legacyPutArgs.includes("--content-encoding"));
    assert.equal(
      buildR2ObjectPutCommand({
        bucket: "b",
        key: "a/c.txt",
        sourceFile: "/out/a/c.txt",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        s3Credentials: true,
        customMetadata: { owner: "savia" },
        storageClass: "InfrequentAccess",
      })[0],
      "aws",
    );
    const [, s3PutArgs] = buildR2ObjectPutCommand({
      bucket: "b",
      key: "a/c.txt",
      sourceFile: "/out/a/c.txt",
      accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
      s3Credentials: true,
      customMetadata: { owner: "savia" },
      storageClass: "InfrequentAccess",
    });
    assert.deepEqual(
      s3PutArgs.slice(
        s3PutArgs.indexOf("--storage-class"),
        s3PutArgs.indexOf("--storage-class") + 2,
      ),
      ["--storage-class", "STANDARD_IA"],
    );
    assert.throws(
      () =>
        buildR2ObjectPutCommand({
          bucket: "b",
          key: "a/c.txt",
          sourceFile: "/out/a/c.txt",
          customMetadata: { owner: "savia" },
          s3Credentials: false,
        }),
      /custom R2 metadata requires/,
    );
    assert.throws(() =>
      buildR2ObjectGetCommand({ bucket: "b", key: "", destFile: "/o" }),
    );
    assert.throws(() =>
      buildR2ObjectGetCommand({
        bucket: "b",
        key: "a/../../x",
        destFile: "/o",
      }),
    );
  });

  it("detects S3 credentials from env", () => {
    assert.equal(
      hasS3Credentials({ AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "s" }),
      true,
    );
    assert.equal(hasS3Credentials({}), false);
    assert.equal(hasS3Credentials({ AWS_ACCESS_KEY_ID: "id" }), false);
    for (const selector of [
      "SAVIA_BACKUP_R2_FORCE_API",
      "SAVIA_BACKUP_R2_FORCE_WRANGLER",
    ]) {
      assert.equal(
        hasS3Credentials({
          AWS_ACCESS_KEY_ID: "id",
          AWS_SECRET_ACCESS_KEY: "s",
          [selector]: "true",
        }),
        false,
      );
    }
  });
});
