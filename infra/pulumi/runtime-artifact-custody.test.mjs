import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptBackup } from "../../scripts/encrypt-flows-backup.mjs";
import { prepareRuntimeArtifact } from "./runtime-publisher.mjs";
import {
  retainPreviewRuntimeArtifact,
  restorePreviewRuntimeArtifact,
  validatePreviewArchiveListing,
} from "./runtime-artifact-custody.mjs";

const key = "a".repeat(64);
const sha = "b".repeat(40);
const configEnv = {
  SAVIA_DEPLOY_ENVIRONMENT: "preview",
  SAVIA_AUTH_D1_ID: "1".repeat(32),
  SAVIA_AUTH_D1_NAME: "savia-auth-preview",
  SAVIA_DOMAIN_D1_ID: "2".repeat(32),
  SAVIA_DOMAIN_D1_NAME: "savia-agencies-preview",
  SAVIA_DOCUMENTS_BUCKET: "savia-documents-preview",
  SAVIA_PUBLIC_ORIGIN: "https://savia-preview.hefesoft.com",
  SAVIA_PAGES_SEARCH_INDEX: "",
  SAVIA_FLOWS_EXECUTION_ENABLED: "false",
  SAVIA_FLOWS_RESOURCES: "",
  SAVIA_TENANT_SUBDOMAINS: "[]",
  SAVIA_PLUGIN_EDITOR_DEPLOYMENT_URL:
    "https://savia-plugin-editor-preview.test-account.workers.dev",
};

async function artifact(directory) {
  const workers = join(directory, "workers", "savia-agencies-preview");
  await mkdir(workers, { recursive: true });
  await writeFile(
    join(directory, "release-source.json"),
    JSON.stringify({ version: 1, sourceRevision: sha }),
  );
  await writeFile(
    join(workers, "index.js"),
    "export default { fetch() { return new Response('ok') } };",
  );
  return prepareRuntimeArtifact({
    environment: "preview",
    release: {
      directory,
      configs: {
        "workers/savia-agencies-preview/wrangler.json": {
          name: "savia-agencies-preview",
          main: "index.js",
        },
      },
    },
    destination: join(directory, "..", "release"),
  });
}

test("round-trips a verified release with same-run, SHA, environment and digest custody", async () => {
  const work = await mkdtemp(join(tmpdir(), "savia-custody-test-"));
  try {
    const source = join(work, "source");
    await mkdir(source);
    const prepared = await artifact(source);
    const retained = join(work, "preview-runtime.enc");
    const provenance = join(work, "preview-runtime.json.enc");
    const identity = {
      runId: "42081871859",
      sourceSha: sha,
      environment: "preview",
      accountId: "c".repeat(32),
    };

    await retainPreviewRuntimeArtifact({
      artifactDirectory: prepared.artifactDirectory,
      archivePath: retained,
      provenancePath: provenance,
      key,
      env: configEnv,
      ...identity,
    });
    const restored = join(work, "restored");
    const githubEnv = join(work, "github-env");
    const result = await restorePreviewRuntimeArtifact({
      archivePath: retained,
      provenancePath: provenance,
      destination: restored,
      key,
      env: { ...configEnv, GITHUB_ENV: githubEnv },
      ...identity,
    });

    assert.equal(result.artifactDigest, prepared.artifactDigest);
    assert.equal(result.configDigest, prepared.configDigest);
    assert.equal(result.restored, true);
    assert.equal(
      JSON.parse(await readFile(join(restored, "release-source.json"), "utf8"))
        .sourceRevision,
      sha,
    );
    assert.equal(
      await readFile(githubEnv, "utf8"),
      `SAVIA_PLUGIN_EDITOR_DEPLOYMENT_URL=${configEnv.SAVIA_PLUGIN_EDITOR_DEPLOYMENT_URL}\n`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("rebuilds instead of reusing a release when freshly rendered config has changed", async () => {
  const work = await mkdtemp(join(tmpdir(), "savia-custody-test-"));
  try {
    const source = join(work, "source");
    await mkdir(source);
    const prepared = await artifact(source);
    const archivePath = join(work, "preview-runtime.enc");
    const provenancePath = join(work, "preview-runtime.json.enc");
    const identity = {
      runId: "42081871859",
      sourceSha: sha,
      environment: "preview",
      accountId: "c".repeat(32),
    };
    await retainPreviewRuntimeArtifact({
      artifactDirectory: prepared.artifactDirectory,
      archivePath,
      provenancePath,
      key,
      env: configEnv,
      ...identity,
    });
    const destination = join(work, "changed-config-restore");
    const result = await restorePreviewRuntimeArtifact({
      archivePath,
      provenancePath,
      destination,
      key,
      env: { ...configEnv, OPENROUTER_MODEL: "different/model" },
      ...identity,
    });

    assert.deepEqual(result, {
      restored: false,
      reason: "current-preview-config-changed",
    });
    await assert.rejects(readFile(join(destination, "release-manifest.json")), {
      code: "ENOENT",
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("refuses a retry whose run, source, environment or account differs", async () => {
  const work = await mkdtemp(join(tmpdir(), "savia-custody-test-"));
  try {
    const source = join(work, "source");
    await mkdir(source);
    const prepared = await artifact(source);
    const archivePath = join(work, "preview-runtime.enc");
    const provenancePath = join(work, "preview-runtime.json.enc");
    const identity = {
      runId: "42081871859",
      sourceSha: sha,
      environment: "preview",
      accountId: "c".repeat(32),
    };
    await retainPreviewRuntimeArtifact({
      artifactDirectory: prepared.artifactDirectory,
      archivePath,
      provenancePath,
      key,
      env: configEnv,
      ...identity,
    });
    for (const mismatch of [
      { runId: "42081871860" },
      { sourceSha: "d".repeat(40) },
      { environment: "production" },
      { accountId: "e".repeat(32) },
    ]) {
      await assert.rejects(
        restorePreviewRuntimeArtifact({
          archivePath,
          provenancePath,
          destination: join(work, `bad-${Object.keys(mismatch)[0]}`),
          key,
          env: configEnv,
          ...identity,
          ...mismatch,
        }),
        /provenance|identity|environment/i,
      );
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("rejects symlinks in a source artifact before archiving", async () => {
  const work = await mkdtemp(join(tmpdir(), "savia-custody-test-"));
  try {
    const source = join(work, "source");
    await mkdir(source);
    const prepared = await artifact(source);
    await symlink(
      "/etc/passwd",
      join(prepared.artifactDirectory, "unsafe-link"),
    );
    await assert.rejects(
      retainPreviewRuntimeArtifact({
        artifactDirectory: prepared.artifactDirectory,
        archivePath: join(work, "preview-runtime.enc"),
        provenancePath: join(work, "preview-runtime.json.enc"),
        key,
        env: configEnv,
        runId: "42081871859",
        sourceSha: sha,
        environment: "preview",
        accountId: "c".repeat(32),
      }),
      /symlink|regular|artifact/i,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("rejects a corrupted encrypted archive without creating a restored release", async () => {
  const work = await mkdtemp(join(tmpdir(), "savia-custody-test-"));
  try {
    const source = join(work, "source");
    await mkdir(source);
    const prepared = await artifact(source);
    const archivePath = join(work, "preview-runtime.enc");
    const provenancePath = join(work, "preview-runtime.json.enc");
    const identity = {
      runId: "42081871859",
      sourceSha: sha,
      environment: "preview",
      accountId: "c".repeat(32),
    };
    await retainPreviewRuntimeArtifact({
      artifactDirectory: prepared.artifactDirectory,
      archivePath,
      provenancePath,
      key,
      env: configEnv,
      ...identity,
    });
    const corrupted = join(work, "corrupted.enc");
    const bytes = await readFile(archivePath);
    bytes[bytes.length - 1] ^= 0xff;
    await writeFile(corrupted, bytes);
    const destination = join(work, "corrupt-restore");

    await assert.rejects(
      restorePreviewRuntimeArtifact({
        archivePath: corrupted,
        provenancePath,
        destination,
        key,
        env: configEnv,
        ...identity,
      }),
    );
    await assert.rejects(readFile(join(destination, "release-manifest.json")), {
      code: "ENOENT",
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("rejects parent traversal, links, duplicates and ambiguous archive listings", () => {
  assert.throws(
    () =>
      validatePreviewArchiveListing(
        "../escape\n",
        "-rw-r--r-- 0/0 1 Jan 1 00:00 ../escape\n",
      ),
    /path is unsafe/i,
  );
  assert.throws(
    () =>
      validatePreviewArchiveListing(
        "./link\n",
        "lrwxrwxrwx 0/0 0 Jan 1 00:00 ./link -> /etc/passwd\n",
      ),
    /unsafe path or link/i,
  );
  assert.throws(
    () =>
      validatePreviewArchiveListing(
        "./file\n./file\n",
        "-rw-r--r-- 0/0 1 Jan 1 00:00 ./file\n-rw-r--r-- 0/0 1 Jan 1 00:00 ./file\n",
      ),
    /duplicate/i,
  );
  assert.throws(
    () => validatePreviewArchiveListing("./file\n", ""),
    /ambiguous/i,
  );
});
