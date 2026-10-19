import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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

test("immutable artifacts cannot publish code or assets outside the frozen directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-artifact-boundary-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "worker.mjs"), "export default {};");
    for (const [index, config] of [
      { main: "../outside.mjs" },
      { main: "/private/outside.mjs" },
      { main: "worker.mjs", assets: { directory: "../../outside" } },
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
