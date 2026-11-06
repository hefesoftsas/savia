import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareRuntimeArtifact,
  verifyRuntimeArtifact,
  publishRuntime,
} from "./runtime-publisher.mjs";

test("prepared artifacts have stable digests independent of staging paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-artifact-test-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "worker.mjs"), "export default {};");
    const release = {
      directory: source,
      configs: {
        "wrangler.json": { name: "savia-preview", main: "worker.mjs" },
      },
    };
    const a = await prepareRuntimeArtifact({
      environment: "preview",
      release,
      destination: join(root, "a"),
    });
    const b = await prepareRuntimeArtifact({
      environment: "preview",
      release,
      destination: join(root, "b"),
    });
    assert.equal(a.artifactDigest, b.artifactDigest);
    assert.equal(a.configDigest, b.configDigest);
    await verifyRuntimeArtifact(a);
    const manifestPath = join(root, "b", "release-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.releaseSource = {
      version: 1,
      sourceRevision: "b".repeat(40),
      codeOnly: {
        base: "a".repeat(40),
        head: "b".repeat(40),
        targets: ["auth"],
      },
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal(
      (await verifyRuntimeArtifact(b)).releaseSource,
      undefined,
      "only the digest-covered source file can supply release scope",
    );
    await writeFile(join(root, "a", "worker.mjs"), "tampered");
    await assert.rejects(verifyRuntimeArtifact(a), /digest/);
    await assert.rejects(
      prepareRuntimeArtifact({
        environment: "preview",
        release: { ...release, configs: { "../escape": {} } },
        destination: join(root, "c"),
      }),
      /config/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication preserves backup, quiescence and migration order", async () => {
  const calls = [];
  const ops = Object.fromEntries(
    [
      "quiesce",
      "backup",
      "migrate",
      "secrets",
      "deploy",
      "verify",
      "resume",
    ].map((step) => [step, async () => calls.push(step)]),
  );
  await publishRuntime({}, ops);
  assert.deepEqual(calls, [
    "quiesce",
    "backup",
    "migrate",
    "secrets",
    "deploy",
    "verify",
    "resume",
  ]);
  calls.length = 0;
  ops.migrate = async () => {
    throw new Error("migration failed");
  };
  await assert.rejects(publishRuntime({}, ops), /migration failed/);
  assert.deepEqual(calls, ["quiesce", "backup"]);
});

test("publication records successful and failed phase timings without changing error propagation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-runtime-phases-"));
  try {
    const ops = Object.fromEntries(
      [
        "quiesce",
        "backup",
        "migrate",
        "secrets",
        "deploy",
        "verify",
        "resume",
      ].map((phase) => [phase, async () => {}]),
    );
    ops.migrate = async () => {
      throw new Error("SENTINEL_SECRET:failed migration");
    };
    await assert.rejects(
      publishRuntime({}, ops, { timingDirectory: directory }),
      /SENTINEL_SECRET:failed migration/,
    );
    const [file] = await readdir(directory);
    const content = await readFile(join(directory, file), "utf8");
    const rows = content.trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      rows.map(({ label, outcome }) => [label, outcome]),
      [
        ["phase:quiesce", "success"],
        ["phase:backup", "success"],
        ["phase:migrate", "failure"],
      ],
    );
    assert.ok(rows.every((row) => Number.isSafeInteger(row.durationMs)));
    assert.doesNotMatch(content, /SENTINEL_SECRET|failed migration/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("immutable artifacts cannot publish code or assets outside the frozen directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-artifact-boundary-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "worker.mjs"), "export default {};");
    for (const [index, config] of [
      { main: "../outside.mjs" },
      {
        main: "worker.mjs",
        vars: { BETTER_AUTH_BOOTSTRAP_PASSWORD: "CREDENTIAL_CANARY" },
      },
      { main: "/private/outside.mjs" },
      { main: "worker.mjs", assets: { directory: "../../outside" } },
      {
        main: "worker.mjs",
        d1_databases: [{ migrations_dir: "../../outside" }],
      },
      { main: "worker.mjs", build: { command: "download-unhashed-code" } },
    ].entries()) {
      await assert.rejects(
        prepareRuntimeArtifact({
          environment: "preview",
          release: { directory: source, configs: { "wrangler.json": config } },
          destination: join(root, `artifact-${index}`),
        }),
        /artifact|frozen|build/,
      );
    }
    await writeFile(join(source, ".env"), "PRIVATE_CREDENTIAL=canary");
    await assert.rejects(
      prepareRuntimeArtifact({
        environment: "preview",
        release: { directory: source, configs: {} },
        destination: join(root, "with-secret"),
      }),
      /credential|private/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verified artifacts declare local namespaces and refuse destructive migrations before publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-artifact-namespaces-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "worker.mjs"), "export default {};");
    const config = {
      name: "savia-preview",
      main: "worker.mjs",
      durable_objects: {
        bindings: [
          { name: "LOCAL", class_name: "Existing" },
          { name: "REMOTE", class_name: "Remote", script_name: "other-worker" },
        ],
      },
    };
    for (const [index, migrations] of [
      undefined,
      [{ tag: "v2", deleted_classes: ["Existing"] }],
      [
        {
          tag: "v2",
          transferred_classes: [
            { from: "Existing", from_script: "outside", to: "Existing" },
          ],
        },
      ],
    ].entries()) {
      const artifact = await prepareRuntimeArtifact({
        environment: "preview",
        release: {
          directory: source,
          configs: {
            "worker.json": { ...config, ...(migrations ? { migrations } : {}) },
          },
        },
        destination: join(root, `artifact-${index}`),
      });
      if (index === 0) {
        const verified = await verifyRuntimeArtifact(artifact);
        assert.deepEqual(verified.declaredNamespaces, [
          { workerName: "savia-preview", className: "Existing" },
        ]);
      } else {
        await assert.rejects(
          verifyRuntimeArtifact(artifact),
          /destructive|transfer/i,
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
