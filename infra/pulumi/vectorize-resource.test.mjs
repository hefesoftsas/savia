import test from "node:test";
import assert from "node:assert/strict";
import {
  validateVectorizeInputs,
  makeVectorizeProvider,
} from "./vectorize-resource.mjs";
const inputs = {
  accountId: "a".repeat(32),
  environment: "preview",
  name: "savia-pages-search-preview",
  dimensions: 1024,
  metric: "cosine",
  adoptExisting: true,
  deleteData: false,
};
test("Vectorize is limited to the reviewed Preview index and immutable shape", async () => {
  assert.deepEqual(validateVectorizeInputs(inputs), inputs);
  for (const patch of [
    { environment: "production" },
    { dimensions: 768 },
    { metric: "euclidean" },
    { accountId: "bad" },
    { name: "other-index" },
  ])
    assert.throws(() => validateVectorizeInputs({ ...inputs, ...patch }));
  const provider = makeVectorizeProvider(async () => ({}));
  assert.deepEqual(
    await provider.diff("index", inputs, { ...inputs, adoptExisting: false }),
    { changes: false, replaces: [] },
  );
  await assert.rejects(
    provider.diff("index", inputs, { ...inputs, name: "other-index" }),
  );
});
test("Vectorize adoption and refresh cannot create or change an index", async () => {
  const calls = [];
  const provider = makeVectorizeProvider(async () => ({
    read: async () => {
      calls.push("read");
      return {
        name: inputs.name,
        config: { dimensions: 1024, metric: "cosine" },
      };
    },
    create: async () => calls.push("create"),
    remove: async () => calls.push("remove"),
  }));
  const result = await provider.create(inputs);
  assert.equal(result.id, `${inputs.accountId}/${inputs.name}`);
  await provider.read(result.id, result.outs);
  assert.deepEqual(calls, ["read", "read"]);
  await assert.rejects(
    provider.delete(result.id, result.outs),
    /explicit.*data/i,
  );
  await provider.delete(result.id, { ...result.outs, deleteData: true });
  assert.equal(calls.at(-1), "remove");
});
test("missing or incompatible adopted Vectorize index fails closed", async () => {
  for (const value of [
    undefined,
    { name: inputs.name, config: { dimensions: 768, metric: "cosine" } },
  ]) {
    let writes = 0;
    const provider = makeVectorizeProvider(async () => ({
      read: async () => value,
      create: async () => writes++,
    }));
    await assert.rejects(provider.create(inputs), /missing|configuration/i);
    assert.equal(writes, 0);
  }
});

test("serialized Vectorize provider reconstructs without capturing execution credentials", async () => {
  const pulumi = await import("@pulumi/pulumi");
  const { createRequire } = await import("node:module");
  const previous = process.env.SAVIA_VECTORIZE_TEST_TOKEN;
  process.env.SAVIA_VECTORIZE_TEST_TOKEN = "VECTORIZE_CREDENTIAL_CANARY";
  try {
    const provider = makeVectorizeProvider(async (input) => ({
      read: async () => ({
        name: input.name,
        config: { dimensions: 1024, metric: "cosine" },
      }),
    }));
    const serialized = await pulumi.runtime.serializeFunction(() => provider);
    assert.equal(
      serialized.text.includes(process.env.SAVIA_VECTORIZE_TEST_TOKEN),
      false,
    );
    const exports = {};
    new Function("exports", "require", serialized.text)(
      exports,
      createRequire(import.meta.url),
    );
    const restored = exports[serialized.exportName]();
    assert.deepEqual((await restored.create(inputs)).outs, inputs);
  } finally {
    if (previous === undefined) delete process.env.SAVIA_VECTORIZE_TEST_TOKEN;
    else process.env.SAVIA_VECTORIZE_TEST_TOKEN = previous;
  }
});
