import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  parseRestoreArgs,
  validateManifest,
  buildD1ExecuteCommand,
  buildR2RestoreCommand,
  listLocalFiles,
  needsMigrations,
  readSidecar,
  resolveManifestPath,
  metadataForObject,
  buildR2ObjectRestorePlan,
  runPulumiUpForRestore,
  verifyManifestIntegrity,
  assertFlowsRestoreMaintenance,
  buildFlowsD1MigrationsCommand,
} from "./restore.mjs";
import { resolveInfraNames } from "./naming.mjs";

const MANIFEST = {
  version: 1,
  stack: "preview",
  createdAt: "2026-10-10T00:00:00.000Z",
  pulumiOutputs: {
    resolvedEnvironment: "preview",
    resolvedPublicOrigin: "https://savia-preview.hefesoft.com",
    flowsEnabled: false,
    flowsResources: null,
    cloudflareAccountId: "08a0d36f8b0357684f83e4bfeb6628b6",
    authD1Id: "auth-id",
    domainD1Id: "domain-id",
    documentsBucketName: "savia-documents-preview",
    databaseNames: {
      auth: "savia-auth-preview",
      domain: "savia-agencies-preview",
    },
  },
  d1: { auth: "/out/d1/auth.sql" },
  r2: null,
};

const LIVE_OUTPUTS = {
  ...MANIFEST.pulumiOutputs,
  authD1Id: "recreated-auth-id",
  domainD1Id: "recreated-domain-id",
  workerNames: {
    auth: "savia-auth-preview",
    api: "savia-agencies-preview",
    request: "savia-request-preview",
    hookExecutor: "savia-hook-executor-preview",
    connectors: "savia-connectors-preview",
    mcp: "savia-mcp-preview",
    gateway: "savia-preview",
  },
  deletionProtected: false,
  flowsEnabled: false,
  flowsResources: null,
  plannedFlowsResourceNames: {
    worker: "savia-flows-preview",
    database: "savia-flows-preview",
    kvNamespace: "savia-flows-preview",
    buckets: {
      resources: "savia-flows-resources-preview",
      datasets: "savia-flows-datasets-preview",
      inboxes: "savia-flows-inboxes-preview",
    },
    queue: "savia-flows-execute-preview",
    deadLetterQueue: "savia-flows-execute-dlq-preview",
    workflow: "savia-flows-execute-preview",
  },
};

describe("pulumi restore", () => {
  it("validates v2 Flows D1, preview resource names, R2 buckets, and runtime evidence", () => {
    const names = resolveInfraNames({
      environment: "preview",
      documentsBucket: MANIFEST.pulumiOutputs.documentsBucketName,
      publicOrigin: MANIFEST.pulumiOutputs.resolvedPublicOrigin,
    });
    const flowsResources = {
      databaseId: "flows-d1-id",
      kvNamespaceId: "flows-kv-id",
      workerName: names.flows.worker,
      workflowName: names.flows.workflow,
      queueName: names.flows.queue,
      buckets: names.flows.buckets,
    };
    const snapshot = {
      version: 1,
      id: "snap-1",
      createdAt: "2026-10-12T12:00:00Z",
      executionEnabled: false,
      complete: true,
      objects: [],
    };
    const manifest = {
      ...MANIFEST,
      version: 2,
      pulumiOutputs: {
        ...MANIFEST.pulumiOutputs,
        flowsEnabled: true,
        flowsResources,
        plannedFlowsResourceNames: names.flows,
      },
      d1: {
        auth: "d1/auth.sql",
        [names.flows.database]: "d1/flows.sql",
      },
      r2: {
        bucket: MANIFEST.pulumiOutputs.documentsBucketName,
        path: "r2/documents",
        method: "object-get",
        objects: 0,
        metadataFile: "r2-metadata/documents.json",
      },
      r2Buckets: Object.fromEntries(
        Object.entries(names.flows.buckets).map(([kind, bucket]) => [
          kind,
          {
            bucket,
            path: `r2/flows-${kind}`,
            method: "object-get",
            objects: 0,
            metadataFile: `r2-metadata/flows-${kind}.json`,
          },
        ]),
      ),
      flowsSnapshot: {
        path: "flows/runtime-snapshot.json",
        method: "flows-maintenance-export",
        id: snapshot.id,
        objects: 0,
        pages: 0,
      },
      integrity: {},
    };
    assert.equal(validateManifest(manifest, "preview").stack, "preview");
    assert.throws(
      () => validateManifest({ ...manifest, stack: "production" }, "preview"),
      /resolved environment|not preview/i,
    );
    assert.throws(
      () =>
        validateManifest({ ...manifest, flowsSnapshot: undefined }, "preview"),
      /runtime snapshot evidence/,
    );
    assert.throws(
      () =>
        validateManifest(
          {
            ...manifest,
            r2Buckets: {
              ...manifest.r2Buckets,
              resources: {
                ...manifest.r2Buckets.resources,
                bucket: "savia-flows-resources-production",
              },
            },
          },
          "preview",
        ),
      /missing the resources R2 backup/,
    );
  });

  it("detects corrupted v2 SQL and metadata files before restore", async () => {
    const base = await mkdtemp(join(tmpdir(), "integrity-restore-"));
    const sql = join(base, "auth.sql");
    await writeFile(sql, "select 1;\n");
    const digest = createHash("sha256").update("select 1;\n").digest("hex");
    const manifest = {
      version: 2,
      d1: { auth: "auth.sql" },
      integrity: { "auth.sql": digest },
    };
    const manifestFile = join(base, "manifest.json");
    await writeFile(manifestFile, JSON.stringify(manifest));
    await verifyManifestIntegrity(manifest, manifestFile);
    await writeFile(sql, "select 2;\n");
    await assert.rejects(
      verifyManifestIntegrity(manifest, manifestFile),
      /integrity check failed/,
    );
  });

  it("requires hashes for every captured payload and rejects payload corruption", async () => {
    const base = await mkdtemp(join(tmpdir(), "integrity-r2-restore-"));
    const files = ["r2/resources/object.bin", "r2-metadata/resources.json"];
    await mkdir(join(base, "r2", "resources"), { recursive: true });
    await mkdir(join(base, "r2-metadata"), { recursive: true });
    await writeFile(join(base, files[0]), "object bytes");
    await writeFile(join(base, files[1]), "{}\n");
    const integrity = Object.fromEntries(
      await Promise.all(
        files.map(async (path) => [
          path,
          createHash("sha256")
            .update(await readFile(join(base, path)))
            .digest("hex"),
        ]),
      ),
    );
    const manifest = { version: 2, integrity };
    const manifestFile = join(base, "manifest.json");
    await writeFile(manifestFile, JSON.stringify(manifest));
    await verifyManifestIntegrity(manifest, manifestFile);

    await writeFile(join(base, files[0]), "altered bytes");
    await assert.rejects(
      verifyManifestIntegrity(manifest, manifestFile),
      /integrity check failed/i,
    );

    const missingHash = {
      ...manifest,
      integrity: { [files[1]]: integrity[files[1]] },
    };
    await assert.rejects(
      verifyManifestIntegrity(missingHash, manifestFile),
      /integrity hash inventory does not cover every backup file/i,
    );
  });

  it("rejects extra Flows bucket targets", () => {
    const names = resolveInfraNames({
      environment: "preview",
      documentsBucket: MANIFEST.pulumiOutputs.documentsBucketName,
      publicOrigin: MANIFEST.pulumiOutputs.resolvedPublicOrigin,
    });
    const flowsResources = {
      databaseId: "flows-d1-id",
      kvNamespaceId: "flows-kv-id",
      workerName: names.flows.worker,
      workflowName: names.flows.workflow,
      queueName: names.flows.queue,
      deadLetterQueueName: names.flows.deadLetterQueue,
      buckets: names.flows.buckets,
    };
    const flowsBuckets = Object.fromEntries(
      Object.entries(names.flows.buckets).map(([kind, bucket]) => [
        kind,
        {
          bucket,
          path: `r2/flows-${kind}`,
          method: "object-get",
          objects: 0,
          metadataFile: `r2-metadata/flows-${kind}.json`,
        },
      ]),
    );
    const snapshot = {
      version: 1,
      id: "snap-1",
      createdAt: "2026-10-12T12:00:00Z",
      executionEnabled: false,
      complete: true,
      objects: [],
    };
    const manifest = {
      ...MANIFEST,
      version: 2,
      pulumiOutputs: {
        ...MANIFEST.pulumiOutputs,
        flowsEnabled: true,
        flowsResources,
        plannedFlowsResourceNames: names.flows,
      },
      d1: { [names.flows.database]: "d1/flows.sql" },
      r2: {
        bucket: MANIFEST.pulumiOutputs.documentsBucketName,
        path: "r2/documents",
        method: "object-get",
        objects: 0,
        metadataFile: "r2-metadata/documents.json",
      },
      r2Buckets: {
        ...flowsBuckets,
        unexpected: {
          bucket: "other-bucket",
          path: "r2/unexpected",
          method: "object-get",
          objects: 0,
          metadataFile: "r2-metadata/unexpected.json",
        },
      },
      flowsSnapshot: {
        path: "flows/runtime-snapshot.json",
        method: "flows-maintenance-export",
        id: snapshot.id,
        objects: 0,
        pages: 0,
      },
      integrity: {},
    };
    assert.throws(
      () => validateManifest(manifest, "preview"),
      /exactly the resources, datasets, and inboxes R2 backups/i,
    );
  });

  it("requires Flows to be paused, in maintenance, and quiescent before restore", async () => {
    const manifest = {
      ...MANIFEST,
      version: 2,
      pulumiOutputs: { ...MANIFEST.pulumiOutputs, flowsEnabled: true },
    };
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          executionEnabled: false,
          maintenance: true,
          activeRuns: 0,
        }),
        { status: 200 },
      );
    };
    await assertFlowsRestoreMaintenance(manifest, {
      env: { SAVIA_FLOWS_BRIDGE_SECRET: "s".repeat(32) },
      fetchImpl,
    });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://savia-preview.hefesoft.com/api/public/savia-flows/maintenance",
    );
    assert.equal(JSON.parse(calls[0].init.body).action, "status");

    for (const state of [
      { executionEnabled: true, maintenance: true, activeRuns: 0 },
      { executionEnabled: false, maintenance: false, activeRuns: 0 },
      { executionEnabled: false, maintenance: true, activeRuns: 1 },
      { executionEnabled: false, maintenance: true },
    ]) {
      await assert.rejects(
        assertFlowsRestoreMaintenance(manifest, {
          env: { SAVIA_FLOWS_BRIDGE_SECRET: "s".repeat(32) },
          fetchImpl: async () =>
            new Response(JSON.stringify(state), { status: 200 }),
        }),
        /execution paused, maintenance enabled, and zero active runs/i,
      );
    }
    await assert.rejects(
      assertFlowsRestoreMaintenance(manifest, { env: {}, fetchImpl }),
      /SAVIA_FLOWS_BRIDGE_SECRET/i,
    );
    await assert.rejects(
      assertFlowsRestoreMaintenance(manifest, {
        env: { SAVIA_FLOWS_BRIDGE_SECRET: "s".repeat(32) },
        fetchImpl: async () => new Response("{}", { status: 503 }),
      }),
      /maintenance API returned HTTP 503/i,
    );
  });

  it("builds a stack-specific Flows migration command and rejects auth table dumps", () => {
    assert.deepEqual(
      buildFlowsD1MigrationsCommand("savia-flows-preview", "preview"),
      [
        "pnpm",
        [
          "--filter",
          "@savia/flows-api",
          "exec",
          "wrangler",
          "d1",
          "migrations",
          "apply",
          "savia-flows-preview",
          "--remote",
          "--config",
          "wrangler.preview.jsonc",
        ],
      ],
    );
    assert.throws(
      () =>
        validateManifest(
          {
            ...MANIFEST,
            version: 2,
            d1: { auth: "d1/auth.sql" },
            d1Methods: { auth: "table-dump" },
            integrity: {},
          },
          "preview",
        ),
      /auth D1 table-dump restore is unsupported/i,
    );
  });

  it("checks the selected Pulumi account before infrastructure restore", async () => {
    const calls = [];
    const execFileImpl = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "config") {
        return { stdout: "11111111111111111111111111111111\n" };
      }
      return { stdout: "" };
    };

    await assert.rejects(
      runPulumiUpForRestore({
        stack: "preview",
        accountId: MANIFEST.pulumiOutputs.cloudflareAccountId,
        expectedOutputs: MANIFEST.pulumiOutputs,
        cwd: "/pulumi",
        execFileImpl,
      }),
      /account/i,
    );
    assert.deepEqual(calls, [
      {
        command: "pulumi",
        args: ["config", "get", "accountId", "--stack", "preview"],
      },
    ]);
  });

  it("runs pulumi up after the selected account matches the restore target", async () => {
    const calls = [];
    const execFileImpl = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "config") {
        return { stdout: `${MANIFEST.pulumiOutputs.cloudflareAccountId}\n` };
      }
      return args[0] === "stack"
        ? { stdout: JSON.stringify(LIVE_OUTPUTS) }
        : { stdout: "" };
    };

    const liveOutputs = await runPulumiUpForRestore({
      stack: "preview",
      accountId: MANIFEST.pulumiOutputs.cloudflareAccountId,
      expectedOutputs: MANIFEST.pulumiOutputs,
      cwd: "/pulumi",
      execFileImpl,
    });
    assert.equal(liveOutputs.domainD1Id, "recreated-domain-id");
    assert.deepEqual(calls, [
      {
        command: "pulumi",
        args: ["config", "get", "accountId", "--stack", "preview"],
      },
      {
        command: "pulumi",
        args: ["up", "--stack", "preview", "--yes"],
      },
      {
        command: "pulumi",
        args: ["stack", "output", "--stack", "preview", "--json"],
      },
    ]);
  });

  it("refuses live Pulumi output drift before restore data commands", async () => {
    const variants = [
      {
        label: "database name",
        outputs: {
          ...LIVE_OUTPUTS,
          databaseNames: {
            ...LIVE_OUTPUTS.databaseNames,
            domain: "savia-agencies-production",
          },
        },
      },
      {
        label: "Cloudflare account",
        outputs: {
          ...LIVE_OUTPUTS,
          cloudflareAccountId: "11111111111111111111111111111111",
        },
      },
      {
        label: "resolved environment",
        outputs: { ...LIVE_OUTPUTS, resolvedEnvironment: "production" },
      },
    ];
    for (const { label, outputs } of variants) {
      const calls = [];
      const execFileImpl = async (command, args) => {
        calls.push({ command, args });
        if (args[0] === "config") {
          return { stdout: `${MANIFEST.pulumiOutputs.cloudflareAccountId}\n` };
        }
        if (args[0] === "stack") {
          return { stdout: JSON.stringify(outputs) };
        }
        return { stdout: "" };
      };

      await assert.rejects(
        runPulumiUpForRestore({
          stack: "preview",
          accountId: MANIFEST.pulumiOutputs.cloudflareAccountId,
          expectedOutputs: MANIFEST.pulumiOutputs,
          cwd: "/pulumi",
          execFileImpl,
        }),
        /.+/,
        label,
      );
      assert.deepEqual(
        calls.map(({ args }) => args[0]),
        ["config", "up", "stack"],
        `${label} drift must reject before restore data commands`,
      );
    }
  });

  it("requires --apply and --confirm-restore to execute", () => {
    const dry = parseRestoreArgs(["--manifest", "m.json", "--dry-run"]);
    assert.equal(dry.dryRun, true);
    assert.throws(() => parseRestoreArgs(["--manifest", "m.json", "--apply"]));
    const plan = parseRestoreArgs([
      "--manifest",
      "m.json",
      "--apply",
      "--confirm-restore",
      "preview",
    ]);
    assert.equal(plan.confirm, "preview");
  });

  it("refuses manifests for a different stack", () => {
    assert.equal(validateManifest(MANIFEST, "preview").stack, "preview");
    assert.throws(() => validateManifest(MANIFEST, "production"));
    assert.throws(() => validateManifest({ version: 2 }, "preview"));
    assert.throws(() => validateManifest({ version: 1, d1: {} }, "preview"));
  });

  it("refuses outputs whose resolved environment disagrees with the manifest stack", () => {
    assert.throws(
      () =>
        validateManifest(
          {
            ...MANIFEST,
            pulumiOutputs: {
              ...MANIFEST.pulumiOutputs,
              resolvedEnvironment: "production",
            },
          },
          "preview",
        ),
      /resolved environment/i,
    );
    assert.equal(
      validateManifest(
        {
          ...MANIFEST,
          pulumiOutputs: {
            ...MANIFEST.pulumiOutputs,
            resolvedEnvironment: "preview",
          },
        },
        "preview",
      ).stack,
      "preview",
    );
    assert.throws(
      () =>
        validateManifest(
          {
            ...MANIFEST,
            pulumiOutputs: {
              ...MANIFEST.pulumiOutputs,
              resolvedEnvironment: undefined,
            },
          },
          "preview",
        ),
      /resolved environment/i,
    );
    assert.throws(
      () =>
        validateManifest(
          {
            ...MANIFEST,
            pulumiOutputs: {
              ...MANIFEST.pulumiOutputs,
              databaseNames: {
                ...MANIFEST.pulumiOutputs.databaseNames,
                auth: "savia-auth",
              },
            },
          },
          "preview",
        ),
      /database names do not match/,
    );
  });

  it("refuses D1 manifest entries that target another environment's database", () => {
    assert.throws(
      () =>
        validateManifest(
          {
            ...MANIFEST,
            d1: {
              ...MANIFEST.d1,
              "savia-agencies": "/backup/production-agencies.sql",
            },
          },
          "preview",
        ),
      /database name|D1 target|manifest key/i,
    );
  });

  it("refuses a manifest from a different Cloudflare account", () => {
    assert.throws(
      () =>
        validateManifest(
          MANIFEST,
          "preview",
          "11111111111111111111111111111111",
        ),
      /account/i,
    );
  });

  it("rejects wrong bucket bindings and unsafe v2 paths", () => {
    assert.throws(
      () =>
        validateManifest(
          {
            ...MANIFEST,
            r2: {
              bucket: "savia-documents-production",
              path: "r2/documents",
              method: "object-get",
              objects: 0,
              metadataFile: "r2-metadata/documents.json",
            },
          },
          "preview",
        ),
      /documents R2 bucket does not match/,
    );
    assert.throws(
      () =>
        validateManifest(
          {
            ...MANIFEST,
            version: 2,
            d1: { auth: "../../outside.sql" },
            integrity: {},
            pulumiOutputs: {
              ...MANIFEST.pulumiOutputs,
              flowsEnabled: false,
              flowsResources: null,
            },
          },
          "preview",
        ),
      /unsafe backup file path/,
    );
  });

  it("refuses unsupported D1 restore methods before applying a manifest", () => {
    assert.throws(
      () =>
        validateManifest(
          {
            ...MANIFEST,
            d1Methods: { auth: "unknown-method" },
          },
          "preview",
        ),
      /unsupported D1 method/i,
    );
  });

  it("accepts current environment-specific D1 names from backups", () => {
    const manifest = {
      ...MANIFEST,
      d1: {
        "savia-auth-preview": "d1/savia-auth-preview.sql",
        "savia-agencies-preview": "d1/savia-agencies-preview.sql",
      },
      d1Methods: {
        "savia-auth-preview": "export",
        "savia-agencies-preview": "table-dump",
      },
    };

    assert.equal(validateManifest(manifest, "preview"), manifest);
  });

  it("resolves relative manifest paths from the manifest directory and supports old absolute paths", () => {
    assert.equal(
      resolveManifestPath("/backup/relocated/manifest.json", "d1/auth.sql"),
      "/backup/relocated/d1/auth.sql",
    );
    assert.equal(
      resolveManifestPath("/backup/manifest.json", "/old/out/d1/auth.sql"),
      "/old/out/d1/auth.sql",
    );
    assert.throws(
      () => resolveManifestPath("/backup/manifest.json", "../../outside.sql"),
      /escapes the manifest directory/,
    );
  });

  it("builds D1 load and R2 sync-back commands", () => {
    const [command, args] = buildD1ExecuteCommand("savia-auth", "/out/a.sql");
    assert.equal(command, "pnpm");
    assert.ok(args.includes("execute"));
    assert.ok(args.includes("--remote"));
    assert.ok(args.includes("--file"));
    const [sync, syncArgs] = buildR2RestoreCommand({
      bucket: "savia-documents",
      sourceDir: "/out/r2",
      accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
    });
    assert.equal(sync, "aws");
    assert.deepEqual(syncArgs.slice(0, 3), ["s3", "sync", "/out/r2"]);
    assert.ok(syncArgs.includes("s3://savia-documents"));
  });

  it("lists local backup files as object keys", async () => {
    const base = await mkdtemp(join(tmpdir(), "r2-restore-"));
    await mkdir(join(base, "a", "b"), { recursive: true });
    await writeFile(join(base, "a", "b", "c.txt"), "x");
    await writeFile(join(base, "root.txt"), "y");
    assert.deepEqual(await listLocalFiles(base), ["a/b/c.txt", "root.txt"]);
  });

  it("detects table dumps needing migrations first", () => {
    assert.equal(
      needsMigrations({ d1Methods: { a: "export", b: "table-dump" } }),
      true,
    );
    assert.equal(needsMigrations({ d1Methods: { a: "export" } }), false);
    assert.equal(needsMigrations({}), false);
    assert.equal(needsMigrations(null), false);
  });

  it("requires a readable metadata sidecar when one is referenced", async () => {
    const base = await mkdtemp(join(tmpdir(), "r2-sidecar-"));
    const file = join(base, "r2-metadata.json");
    await writeFile(
      file,
      JSON.stringify({ "a.txt": { customMetadata: { t: "1" } } }),
    );
    assert.deepEqual(await readSidecar(file), {
      "a.txt": { customMetadata: { t: "1" } },
    });
    await assert.rejects(readSidecar(join(base, "missing.json")));
    assert.deepEqual(await readSidecar(null), {});
  });

  it("requires metadata for each restored R2 object", () => {
    assert.deepEqual(
      metadataForObject(
        { "a.txt": { httpMetadata: {}, customMetadata: {} } },
        "a.txt",
      ),
      {
        httpMetadata: {},
        customMetadata: {},
      },
    );
    assert.throws(() => metadataForObject({}, "a.txt"), /missing object/);
    assert.throws(
      () => metadataForObject({ "a.txt": { ssec: true } }, "a.txt"),
      /encryption key/,
    );
  });

  it("preflights every R2 payload and metadata entry before restoring", async () => {
    const base = await mkdtemp(join(tmpdir(), "r2-restore-plan-"));
    await writeFile(join(base, "a.txt"), "a");
    await writeFile(join(base, "b.txt"), "b");
    const sidecar = {
      "a.txt": { httpMetadata: {}, customMetadata: {} },
      "b.txt": {
        httpMetadata: { contentType: "text/plain" },
        customMetadata: { owner: "savia" },
      },
    };
    await assert.rejects(
      buildR2ObjectRestorePlan({
        bucket: "bucket",
        sourceDir: base,
        sidecar,
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        expectedObjects: 2,
      }),
      /custom R2 metadata requires/,
    );
    await assert.rejects(
      buildR2ObjectRestorePlan({
        bucket: "bucket",
        sourceDir: base,
        sidecar: { "a.txt": sidecar["a.txt"] },
        expectedObjects: 2,
      }),
      /files and metadata sidecar/,
    );
  });

  it("rejects symlinks in a local R2 backup", async () => {
    const base = await mkdtemp(join(tmpdir(), "r2-restore-link-"));
    const elsewhere = await mkdtemp(join(tmpdir(), "r2-outside-"));
    await writeFile(join(elsewhere, "secret"), "x");
    await symlink(elsewhere, join(base, "linked"));
    await assert.rejects(listLocalFiles(base), /symbolic link/);
  });
});
