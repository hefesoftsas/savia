import assert from "node:assert/strict";
import test from "node:test";
import { ensurePreviewPagesSearch } from "./ensure-preview-pages-search.mjs";
const result = {
  success: true,
  result: { config: { dimensions: 1024, metric: "cosine" } },
};
test("verifies existing isolated index without mutation", async () => {
  const calls = [];
  await ensurePreviewPagesSearch({
    accountId: "account",
    apiToken: "token",
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return Response.json(result);
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /savia-pages-search-preview$/);
  assert.equal(calls[0].init.method, undefined);
});
test("creates the preview index only after a not found response", async () => {
  const calls = [];
  await ensurePreviewPagesSearch({
    accountId: "account",
    apiToken: "token",
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1
        ? Response.json({ success: false }, { status: 404 })
        : Response.json(result);
    },
  });
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body).config, {
    dimensions: 1024,
    metric: "cosine",
  });
});
test("permission errors do not trigger creation", async () => {
  let calls = 0;
  await assert.rejects(
    ensurePreviewPagesSearch({
      accountId: "account",
      apiToken: "token",
      fetcher: async () => {
        calls++;
        return Response.json({ success: false }, { status: 403 });
      },
    }),
    /Vectorize edit/,
  );
  assert.equal(calls, 1);
});
