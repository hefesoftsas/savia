import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createLocalCollectionDrain } from "./dev-local.mjs";

const require = createRequire(new URL("../api/package.json", import.meta.url));
const { jwtVerify } = require("jose");
const bridgeSecret = "local-controller-private-key-at-least-32-bytes";

test("the collection recovery controller rejects remote, credentialed and encrypted origins", () => {
  for (const coreOrigin of [
    "https://127.0.0.1:8787",
    "http://example.com",
    "http://user:password@localhost:8787",
    "file:///tmp/core",
  ])
    assert.throws(
      () => createLocalCollectionDrain({ coreOrigin, bridgeSecret }),
      /local core API origin/,
    );
});

test("local recovery uses a dedicated short-lived authority and refuses redirects", async () => {
  let calls = 0;
  const drain = createLocalCollectionDrain({
    bridgeSecret,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(
        url.href,
        "http://127.0.0.1:8787/api/public/savia-flows/drain-events",
      );
      assert.equal(init.redirect, "error");
      assert.equal(init.method, "POST");
      assert.ok(init.signal instanceof AbortSignal);
      const { payload } = await jwtVerify(
        init.headers.authorization.slice(7),
        new TextEncoder().encode(bridgeSecret),
        {
          issuer: "savia-flows",
          audience: "savia-flows-outbox-drain",
          algorithms: ["HS256"],
        },
      );
      assert.equal(payload.sub, "savia-local-outbox");
      assert.equal(payload.exp - payload.iat, 10);
      assert.equal(payload.tenant, undefined);
      return new Response("Unavailable", { status: 503 });
    },
  });
  await assert.rejects(drain, /returned 503/);
  assert.equal(calls, 1);
});
