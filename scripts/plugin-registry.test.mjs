import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  publishRelease,
  downloadRelease,
  validateLock,
  registryConnection,
} from "./plugin-registry.mjs";
const zip = Buffer.from("test transport payload");
const release = {
  id: "custom.demo",
  version: "1.0.0",
  label: "Demo",
  sha256: createHash("sha256").update(zip).digest("hex"),
  sizeBytes: zip.length,
  createdAt: "2026-09-30T00:00:00.000Z",
};
const config = { url: "https://registry.example", token: "a".repeat(32) };
test("publishes bytes without redirects and returns the immutable registry digest", async () => {
  const result = await publishRelease(
    config,
    release,
    zip,
    async (url, init) => {
      assert.equal(
        url,
        "https://registry.example/v1/plugins/custom.demo/1.0.0",
      );
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.authorization, `Bearer ${config.token}`);
      assert.deepEqual(init.body, zip);
      return Response.json({ data: release, deduped: false });
    },
  );
  assert.equal(result.sha256, release.sha256);
});
test("errors exclude service response bodies and secrets", async () => {
  await assert.rejects(
    publishRelease(
      config,
      release,
      zip,
      async () => new Response(config.token, { status: 403 }),
    ),
    /Registry request failed \(HTTP 403\)/,
  );
});
test("downloads a lock-pinned version and rejects changed bytes", async () => {
  assert.deepEqual(
    Buffer.from(
      await downloadRelease(config, release, async () => new Response(zip)),
    ),
    zip,
  );
  await assert.rejects(
    downloadRelease(config, release, async () => new Response("changed")),
    /digest mismatch/,
  );
});
test("rejects malformed or unsafe lockfile identity before download", () => {
  assert.deepEqual(
    validateLock({ schemaVersion: 1, plugins: [release] }).plugins,
    [release],
  );
  for (const bad of [
    { ...release, id: "../../escape" },
    { ...release, version: "../1" },
    { ...release, sha256: "bad" },
  ]) {
    assert.throws(() => validateLock({ schemaVersion: 1, plugins: [bad] }));
  }
  assert.throws(
    () => validateLock({ schemaVersion: 1, plugins: [release, release] }),
    /Duplicate/,
  );
});
test("only secure origins and loopback development endpoints are accepted", () => {
  assert.equal(
    registryConnection({
      SAVIA_PLUGIN_REGISTRY_URL: config.url,
      SAVIA_PLUGIN_REGISTRY_TOKEN: config.token,
    }).url,
    config.url,
  );
  assert.throws(() =>
    registryConnection({
      SAVIA_PLUGIN_REGISTRY_URL: "http://registry.example",
      SAVIA_PLUGIN_REGISTRY_TOKEN: config.token,
    }),
  );
  assert.throws(() =>
    registryConnection({
      SAVIA_PLUGIN_REGISTRY_URL: "https://user:secret@registry.example",
      SAVIA_PLUGIN_REGISTRY_TOKEN: config.token,
    }),
  );
});

test("matches the registry's published manifest identity contract", () => {
  for (const bad of [
    { ...release, id: `a${"b".repeat(100)}` },
    { ...release, version: "1.0.0-preview" },
    { ...release, version: "1.0.0+build" },
    { ...release, version: "1".repeat(30) + ".0.0" },
  ])
    assert.throws(() => validateLock({ schemaVersion: 1, plugins: [bad] }));
});
