import assert from "node:assert/strict";
import test from "node:test";
import { transferDomainRoutes } from "./finalize-domain-transition.mjs";
const route = {
  id: "one",
  pattern: "savia.hefesoft.com/*",
  script: "savia-domain-transition",
};
function api(routes) {
  const mutations = [];
  return {
    mutations,
    fetcher: async (url, init) => {
      if (init.method === "PUT") {
        mutations.push(JSON.parse(init.body));
        return Response.json({ success: true });
      }
      return Response.json({ success: true, result: routes });
    },
  };
}
test("cutover transfers only transition routes and leaves other domains untouched", async () => {
  const mock = api([
    route,
    { ...route, id: "two", pattern: "*.savia.hefesoft.com/*" },
    { id: "unrelated", pattern: "other.hefesoft.com/*", script: "other" },
  ]);
  assert.equal(await transferDomainRoutes({ token: "test-token", ...mock }), 2);
  assert.deepEqual(mock.mutations, [
    { pattern: route.pattern, script: "savia" },
    { pattern: "*.savia.hefesoft.com/*", script: "savia" },
  ]);
});
test("unexpected owners fail before any mutation", async () => {
  const mock = api([
    route,
    { id: "two", pattern: "*.savia.hefesoft.com/*", script: "someone-else" },
  ]);
  await assert.rejects(
    transferDomainRoutes({ token: "test-token", ...mock }),
    /unexpected owner/,
  );
  assert.equal(mock.mutations.length, 0);
});
test("already released routes are idempotent and rollback restores the bridge", async () => {
  const mock = api([
    { ...route, script: "savia" },
    { ...route, id: "two", pattern: "*.savia.hefesoft.com/*", script: "savia" },
  ]);
  assert.equal(await transferDomainRoutes({ token: "test-token", ...mock }), 0);
  assert.equal(
    await transferDomainRoutes({ token: "test-token", restore: true, ...mock }),
    2,
  );
  assert.deepEqual(mock.mutations, [
    { pattern: route.pattern, script: "savia-domain-transition" },
    { pattern: "*.savia.hefesoft.com/*", script: "savia-domain-transition" },
  ]);
});

test("missing or mixed route ownership blocks cutover before mutation", async () => {
  for (const routes of [
    [route],
    [
      route,
      {
        ...route,
        id: "two",
        pattern: "*.savia.hefesoft.com/*",
        script: "savia",
      },
    ],
  ]) {
    const mock = api(routes);
    await assert.rejects(
      transferDomainRoutes({ token: "test-token", ...mock }),
      /incomplete|inconsistent/,
    );
    assert.equal(mock.mutations.length, 0);
  }
});
