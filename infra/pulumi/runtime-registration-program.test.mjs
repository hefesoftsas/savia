import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { previewNames } from "../../scripts/preview-environment.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const accountId = "a".repeat(32);
test("compiled application, branch and shared programs register exact runtime identities and preserve data outputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savia-program-ownership-"));
  try {
    execFileSync(
      process.execPath,
      [
        join(root, "infra/pulumi/node_modules/typescript/bin/tsc"),
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--allowJs",
        "--skipLibCheck",
        "--rewriteRelativeImportExtensions",
        "--rootDir",
        root,
        "--outDir",
        dir,
        ...[
          "index.ts",
          "branch-preview/index.ts",
          "shared-registry/index.ts",
        ].map((file) => join(root, "infra/pulumi", file)),
      ],
      { cwd: root, stdio: "pipe" },
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    await symlink(
      join(root, "infra/pulumi/node_modules"),
      join(dir, "node_modules"),
      "dir",
    );
    await symlink(join(root, "packages"), join(dir, "packages"), "dir");
    const preview = [
      "savia-preview",
      "savia-agencies-preview",
      "savia-auth-preview",
      "savia-mcp-preview",
      "savia-request-preview",
      "savia-connectors-preview",
      "savia-hook-executor-preview",
      "savia-flows-preview",
      "savia-backup-coordinator-preview",
      "savia-plugin-editor-preview",
    ];
    const branch = previewNames("feat-secop-tender-tracke");
    const cases = [
      {
        project: "savia-cloudflare",
        stack: "preview",
        entry: "index.js",
        names: preview,
        config: {
          environment: "preview",
          publicOrigin: "https://savia-preview.hefesoft.com",
          documentsBucket: "savia-documents-preview",
          flowsEnabled: true,
          flowsExecutionEnabled: true,
          pagesSearchIndex: "savia-pages-search-preview",
        },
        outputs: [
          "authD1Id",
          "domainD1Id",
          "documentsBucketName",
          "resolvedEnvironment",
          "flowsResources",
        ],
      },
      {
        project: "savia-branch-preview",
        stack: "branch-feat-secop-tender-tracke",
        entry: "branch-preview/index.js",
        names: Object.values(branch.workers).filter(
          (name) => !name.includes("connectors"),
        ),
        config: {
          branchSlug: branch.slug,
          authDatabaseName: branch.databases.auth,
          domainDatabaseName: branch.databases.domain,
          bucketName: branch.bucket,
        },
        outputs: [
          "authD1Id",
          "domainD1Id",
          "documentsBucketName",
          "branchSlug",
        ],
      },
      {
        project: "savia-shared-registry",
        stack: "shared",
        entry: "shared-registry/index.js",
        names: ["savia-plugin-registry"],
        config: { adoptExisting: false },
        outputs: [
          "bucketName",
          "workerName",
          "bucketProtected",
          "registryWorkerManifest",
        ],
      },
    ];
    // previewNames uses suffix rather than a separate slug field.
    cases[1].config.branchSlug = "feat-secop-tender-tracke";
    for (const example of cases) {
      const config = Object.fromEntries(
        Object.entries({
          accountId,
          ...example.config,
          runtimeManaged: true,
          runtimeMode: "adopt",
          runtimeProfile: { enabledWorkers: example.names },
          adoptionManifest: {
            version: 1,
            accountId,
            environment: example.stack,
            project: example.project,
            stack: example.stack,
            profile: { enabledWorkers: example.names },
            resources: example.names.map((name, i) => ({
              kind: "worker",
              name,
              cloudId: i.toString(16).padStart(32, "b"),
            })),
          },
        }).map(([key, value]) => [
          `${example.project}:${key}`,
          typeof value === "string" ? value : JSON.stringify(value),
        ]),
      );
      const script = join(dir, `check-${example.stack}.mjs`);
      await writeFile(
        script,
        `import * as pulumi from '@pulumi/pulumi';
const resources=[];
pulumi.runtime.setMocks({newResource:args=>{resources.push({type:args.type,name:args.name,inputs:args.inputs});return {id:args.type.includes('Worker')?'b'.repeat(32):args.name,state:{...args.inputs,uuid:'11111111-1111-1111-1111-111111111111',status:'adopted',workerVersions:[],namespaceIds:[],attachments:[],retentionWorkerNames:[]}};},call:args=>args.inputs},${JSON.stringify(example.project)},${JSON.stringify(example.stack)});
const program=await import(${JSON.stringify(new URL(`infra/pulumi/${example.entry}`, `file://${dir}/`).href)});
const values=await pulumi.output(Object.fromEntries(Object.entries(program))).promise();
process.stdout.write(JSON.stringify({resources,values}));`,
      );
      const output = JSON.parse(
        execFileSync(process.execPath, [script], {
          cwd: join(dir, "infra/pulumi"),
          env: { ...process.env, PULUMI_CONFIG: JSON.stringify(config) },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
      const workers = output.resources.filter(
        (row) => row.type === "cloudflare:index/worker:Worker",
      );
      assert.deepEqual(
        workers.map((row) => row.inputs.name).sort(),
        [...example.names].sort(),
      );
      assert.equal(
        workers.every(
          (row) =>
            row.inputs.force === false &&
            Object.keys(row.inputs).sort().join(",") === "accountId,force,name",
        ),
        true,
      );
      assert.equal(
        output.resources.filter(
          (row) => row.type === "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
        ).length,
        1,
      );
      assert.equal(
        output.resources.some((row) =>
          /Workflow|WorkersRoute|Cron/.test(row.type),
        ),
        false,
      );
      assert.equal(output.values.runtimeStatus, "adopted");
      assert.equal(
        output.values.environmentInventory.resources.filter(
          (row) => row.kind === "worker",
        ).length,
        example.names.length,
      );
      for (const name of example.outputs)
        assert.ok(name in output.values, `missing ${example.project}/${name}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
