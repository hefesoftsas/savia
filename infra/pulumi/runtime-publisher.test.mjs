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
