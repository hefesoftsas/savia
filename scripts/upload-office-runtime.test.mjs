import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliCompressSync } from "node:zlib";

import { buildOfficeRuntimeUploadPlan } from "./upload-office-runtime.mjs";

const files = {
  "soffice.js": "text/javascript",
  "soffice.wasm": "application/wasm",
  "soffice.data": "application/octet-stream",
  "soffice.data.js.metadata": "application/json",
  "zeta.js": "text/javascript",
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "savia-office-upload-"));
  const build = "zeta-2025-05-13-testbuild";
  const upload = join(root, ".cache", "office-runtime", build, "upload");
  await mkdir(upload, { recursive: true });
  const manifest = { build, files: {} };
  const inventory = [];
  for (const [name, type] of Object.entries(files)) {
    const bytes = Buffer.from(`verified runtime fixture: ${name}`);
    const compressed = brotliCompressSync(bytes);
    const path = join(upload, name + ".br");
    await writeFile(path, compressed);
    manifest.files[name] = {
      type,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    inventory.push({
      key: `office-runtime/${build}/${name}`,
      file: path,
      contentType: type,
      contentEncoding: "br",
      size: compressed.length,
    });
  }
  return { root, build, upload, manifest, inventory };
}

test("builds exact preview R2 upload commands from the pinned package inventory", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));

  const plan = await buildOfficeRuntimeUploadPlan({
    environment: "preview",
    bucket: "savia-documents-preview",
    accountId: "account-id",
    apiToken: "token-value",
    ...data,
  });

  assert.equal(plan.length, 5);
  assert.deepEqual(plan[1].args, [
    "--filter",
    "@savia/api",
    "exec",
    "wrangler",
    "r2",
    "object",
    "put",
    "savia-documents-preview/office-runtime/" + data.build + "/soffice.wasm",
    "--file",
    join(data.upload, "soffice.wasm.br"),
    "--content-type",
    "application/wasm",
    "--content-encoding",
    "br",
    "--remote",
  ]);
  assert.equal(plan[1].executable, "pnpm");
  assert.equal(plan[1].options.cwd, data.root);
  assert.equal(plan[1].options.env.SAVIA_DEPLOY_ENVIRONMENT, "preview");
  assert.equal(plan[1].options.env.CLOUDFLARE_API_TOKEN, "token-value");
});

test("refuses production deployment mode or any bucket except the isolated preview bucket", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));

  await assert.rejects(
    buildOfficeRuntimeUploadPlan({
      environment: "production",
      bucket: "savia-documents-preview",
      accountId: "account-id",
      apiToken: "token-value",
      ...data,
    }),
    /preview deployment only/,
  );
  await assert.rejects(
    buildOfficeRuntimeUploadPlan({
      environment: "preview",
      bucket: "savia-documents",
      accountId: "account-id",
      apiToken: "token-value",
      ...data,
    }),
    /savia-documents-preview/,
  );
});

test("rejects runtime inventory paths or keys that escape the pinned build prefix", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));

  const wrongPath = structuredClone(data.inventory);
  wrongPath[0].file = join(data.root, "outside.br");
  await assert.rejects(
    buildOfficeRuntimeUploadPlan({
      environment: "preview",
      bucket: "savia-documents-preview",
      accountId: "account-id",
      apiToken: "token-value",
      ...data,
      inventory: wrongPath,
    }),
    /unexpected runtime asset path/,
  );

  const wrongKey = structuredClone(data.inventory);
  wrongKey[0].key = "office-runtime/another-build/soffice.js";
  await assert.rejects(
    buildOfficeRuntimeUploadPlan({
      environment: "preview",
      bucket: "savia-documents-preview",
      accountId: "account-id",
      apiToken: "token-value",
      ...data,
      inventory: wrongKey,
    }),
    /unexpected runtime object key/,
  );
});

test("rejects package bytes that do not match the manifest hash or metadata", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));

  const badType = structuredClone(data.inventory);
  badType[0].contentType = "text/html";
  await assert.rejects(
    buildOfficeRuntimeUploadPlan({
      environment: "preview",
      bucket: "savia-documents-preview",
      accountId: "account-id",
      apiToken: "token-value",
      ...data,
      inventory: badType,
    }),
    /content type/,
  );

  const badHash = structuredClone(data.manifest);
  badHash.files["soffice.js"].sha256 = "0".repeat(64);
  await assert.rejects(
    buildOfficeRuntimeUploadPlan({
      environment: "preview",
      bucket: "savia-documents-preview",
      accountId: "account-id",
      apiToken: "token-value",
      ...data,
      manifest: badHash,
    }),
    /checksum mismatch/,
  );
});
