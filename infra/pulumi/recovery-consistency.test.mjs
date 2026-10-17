import assert from "node:assert/strict";
import test from "node:test";
import {
  captureRecoveryBoundary,
  verifyRecoveryBoundary,
} from "./recovery-consistency.mjs";

const accountId = "a".repeat(32);
const id = "11111111-1111-4111-8111-111111111111";
const objects = [
  { key: "document", size: 4, etag: "abcd", customMetadata: { tenant: "1" } },
];
function fixture() {
  const state = {
    bookmark: "00000001",
    name: "savia-agencies",
    objects,
    fail: false,
    calls: [],
  };
  const options = {
    accountId,
    token: "redacted",
    databases: { "savia-agencies": id },
    buckets: ["savia-documents"],
    listObjects: async () => state.objects,
    fetchImpl: async (url, options) => {
      state.calls.push([url, options.method ?? "GET"]);
      return {
        ok: !state.fail,
        status: state.fail ? 403 : 200,
        json: async () => ({
          success: !state.fail,
          result: url.endsWith("/bookmark")
            ? { bookmark: state.bookmark }
            : { uuid: id, name: state.name },
        }),
      };
    },
  };
  return { state, options };
}

test("accepts only unchanged D1 bookmarks and R2 inventories across the entire capture", async () => {
  const { state, options } = fixture();
  const boundary = await captureRecoveryBoundary(options);
  const proof = await verifyRecoveryBoundary(boundary, options);
  assert.equal(proof.version, 1);
  assert.equal(proof.d1["savia-agencies"].bookmark, "00000001");
  assert.match(proof.r2["savia-documents"], /^[a-f0-9]{64}$/);
  assert.ok(state.calls.every(([, method]) => method === "GET"));
  assert.ok(!JSON.stringify(proof).includes("redacted"));
});

test("refuses concurrent D1 writes, identity mismatches, denied or missing bookmarks", async () => {
  for (const change of [
    { bookmark: "00000002" },
    { name: "savia-agencies-preview" },
    { fail: true },
    { bookmark: "" },
  ]) {
    const { state, options } = fixture();
    const boundary = await captureRecoveryBoundary(options);
    Object.assign(state, change);
    await assert.rejects(verifyRecoveryBoundary(boundary, options));
  }
});

test("refuses added, deleted, overwritten and metadata-only R2 changes", async () => {
  for (const replacement of [
    [],
    [...objects, { key: "other", size: 0, etag: "other" }],
    [{ ...objects[0], etag: "changed" }],
    [{ ...objects[0], customMetadata: { tenant: "2" } }],
  ]) {
    const { state, options } = fixture();
    const boundary = await captureRecoveryBoundary(options);
    state.objects = replacement;
    await assert.rejects(
      verifyRecoveryBoundary(boundary, options),
      /R2.*changed/,
    );
  }
});

test("normalizes object order but fails closed on incomplete or repeated R2 identities", async () => {
  const { state, options } = fixture();
  state.objects = [...objects, { key: "second", size: 0, etag: "defg" }];
  const boundary = await captureRecoveryBoundary(options);
  state.objects = [...state.objects].reverse();
  await verifyRecoveryBoundary(boundary, options);
  for (const bad of [[{ key: "x", size: 0 }], [objects[0], objects[0]]]) {
    state.objects = bad;
    await assert.rejects(captureRecoveryBoundary(options), /R2/);
  }
});

test("rejects invalid account or database IDs before any API call", async () => {
  const { state, options } = fixture();
  await assert.rejects(
    captureRecoveryBoundary({ ...options, accountId: "placeholder" }),
  );
  await assert.rejects(
    captureRecoveryBoundary({
      ...options,
      databases: { "savia-agencies": "placeholder" },
    }),
  );
  assert.equal(state.calls.length, 0);
});

test("classifies only capture drift as retryable, never identity or credential failures", async () => {
  const { isRecoveryConsistencyDrift } =
    await import("./recovery-consistency.mjs");
  assert.equal(typeof isRecoveryConsistencyDrift, "function");
  for (const change of [{ bookmark: "after-write" }, { objects: [] }]) {
    const { state, options } = fixture();
    const boundary = await captureRecoveryBoundary(options);
    Object.assign(state, change);
    await assert.rejects(verifyRecoveryBoundary(boundary, options), (error) => {
      assert.equal(error.code, "RECOVERY_CONSISTENCY_DRIFT");
      assert.equal(isRecoveryConsistencyDrift(error), true);
      return true;
    });
  }
  for (const change of [
    { name: "wrong-database" },
    { fail: true },
    { bookmark: "" },
  ]) {
    const { state, options } = fixture();
    const boundary = await captureRecoveryBoundary(options);
    Object.assign(state, change);
    await assert.rejects(verifyRecoveryBoundary(boundary, options), (error) => {
      assert.equal(isRecoveryConsistencyDrift(error), false);
      return true;
    });
  }
  assert.equal(
    isRecoveryConsistencyDrift(new Error("D1 changed during backup")),
    false,
  );
});
