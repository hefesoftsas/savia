import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const ts = require("typescript");
const source = await readFile(
  new URL("../apps/admin/src/companion-downloads-catalog.ts", import.meta.url),
  "utf8",
);
const script =
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText + "\nexport default { fetch: companionDownloadsResponse };";

async function withWorker(outboundService, run) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-08-31",
      script,
      outboundService,
    }),
  );
  try {
    await run(mf);
  } finally {
    await mf.dispose();
  }
}

test("the actual Workers runtime fetches and caches the catalog without forwarding credentials", async () => {
  let calls = 0;
  await withWorker(
    (request) => {
      calls++;
      assert.equal(
        request.url,
        "https://api.github.com/repos/hefesoftsas/savia/releases?per_page=30",
      );
      assert.equal(request.headers.get("authorization"), null);
      assert.equal(request.headers.get("cookie"), null);
      assert.equal(
        request.headers.get("user-agent"),
        "Savia-Companion-Downloads",
      );
      return Response.json([]);
    },
    async (mf) => {
      for (let index = 0; index < 2; index++) {
        const response = await mf.dispatchFetch(
          `https://preview.test/companion-downloads.json?v=${index}`,
          {
            headers: {
              authorization: "Bearer incoming-only",
              cookie: "session=incoming-only",
            },
          },
        );
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), []);
        assert.equal(response.headers.get("cache-control"), "no-store");
      }
      assert.equal(calls, 1);
    },
  );
});

test("the actual Workers runtime rejects upstream redirects without following them", async () => {
  let calls = 0;
  await withWorker(
    () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: "https://unexpected.test/catalog" },
      });
    },
    async (mf) => {
      const response = await mf.dispatchFetch(
        "https://preview.test/companion-downloads.json",
      );
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Companion download catalog unavailable",
      });
      assert.equal(calls, 1);
    },
  );
});
