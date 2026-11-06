import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareVscodeDownload } from "./lib/prepare-vscode-download.mjs";

test("all admin distribution builds prepare the VSIX through the common asset build", async () => {
  const admin = JSON.parse(
    await fs.readFile(
      new URL("../apps/admin/package.json", import.meta.url),
      "utf8",
    ),
  );
  for (const command of [admin.scripts.build, admin.scripts["build:assets"]]) {
    assert.ok(command.indexOf("build:downloads") >= 0);
    assert.ok(
      command.indexOf("build:downloads") < command.indexOf("vite build"),
    );
  }
  assert.match(admin.scripts["build:downloads"], /@savia\/vscode build/);
  assert.match(admin.scripts["build:downloads"], /@savia\/vscode package/);
  assert.match(
    admin.scripts["build:downloads"],
    /prepare-vscode-download\.mjs/,
  );
  const docker = await fs.readFile(
    new URL("../apps/self-hosted/Dockerfile", import.meta.url),
    "utf8",
  );
  assert.match(docker, /COPY apps\/vscode\/package\.json apps\/vscode\//);
  assert.match(
    docker,
    /COPY packages\/plugin-authoring\/package\.json packages\/plugin-authoring\//,
  );
  assert.match(docker, /RUN pnpm --filter @savia\/admin run build:assets/);
  assert.doesNotMatch(
    docker,
    /RUN pnpm --filter @savia\/admin exec vite build/,
  );
});

async function fixture(t, { validChecksum = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "savia-vsix-stage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifactsDir = path.join(root, "artifacts");
  const downloadsDir = path.join(root, "downloads");
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(downloadsDir, { recursive: true });
  const version = "1.2.3";
  const filename = `savia-plugin-authoring-${version}.vsix`;
  const bytes = Buffer.from("fake vsix payload");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const manifestPath = path.join(root, "package.json");
  await fs.writeFile(manifestPath, JSON.stringify({ version }));
  await fs.writeFile(path.join(artifactsDir, filename), bytes);
  await fs.writeFile(
    path.join(artifactsDir, `${filename}.sha256`),
    `${validChecksum ? checksum : "0".repeat(64)} ${filename}\n`,
  );
  return {
    artifactsDir,
    bytes,
    checksum,
    downloadsDir,
    filename,
    manifestPath,
  };
}

test("stages the manifest-versioned VSIX and checksum while preserving unrelated files", async (t) => {
  const setup = await fixture(t);
  const previous = "savia-plugin-authoring-0.9.0.vsix";
  await fs.writeFile(path.join(setup.downloadsDir, previous), "old version");
  await fs.writeFile(path.join(setup.downloadsDir, "readme.txt"), "keep me");

  const result = await prepareVscodeDownload(setup);

  assert.equal(result.filename, setup.filename);
  assert.equal(result.checksum, setup.checksum);
  assert.deepEqual(
    await fs.readFile(path.join(setup.downloadsDir, setup.filename)),
    setup.bytes,
  );
  assert.equal(
    await fs.readFile(
      path.join(setup.downloadsDir, `${setup.filename}.sha256`),
      "utf8",
    ),
    `${setup.checksum} ${setup.filename}\n`,
  );
  await assert.rejects(fs.stat(path.join(setup.downloadsDir, previous)), {
    code: "ENOENT",
  });
  assert.equal(
    await fs.readFile(path.join(setup.downloadsDir, "readme.txt"), "utf8"),
    "keep me",
  );
});

test("rejects a checksum mismatch without changing staged files", async (t) => {
  const setup = await fixture(t, { validChecksum: false });
  const existing = path.join(setup.downloadsDir, setup.filename);
  await fs.writeFile(existing, "previously staged");
  await fs.writeFile(path.join(setup.downloadsDir, "readme.txt"), "keep me");

  await assert.rejects(
    prepareVscodeDownload(setup),
    /checksum is missing or invalid/,
  );

  assert.equal(await fs.readFile(existing, "utf8"), "previously staged");
  assert.equal(
    await fs.readFile(path.join(setup.downloadsDir, "readme.txt"), "utf8"),
    "keep me",
  );
});
