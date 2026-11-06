import assert from "node:assert/strict";
import test from "node:test";
import {
  captureCanonicalDomainRecovery,
  restoreCanonicalDomainRecovery,
} from "./canonical-domain-recovery.mjs";

const accountId = "0123456789abcdef0123456789abcdef";
const workers = ["savia-auth", "savia-agencies", "savia"];
const versions = Object.fromEntries(
  workers.map((name, index) => [
    name,
    {
      migrationTag: name === "savia" ? null : `v${index + 1}`,
      versions: [
        {
          version_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          percentage: 100,
        },
      ],
    },
  ]),
);

function workerApi({ drift = {}, failDeploy = [] } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method ?? "GET", body: init.body });
    const service = path.match(/\/workers\/services\/([^/]+)$/);
    if (service) {
      const name = service[1];
      return Response.json({
        success: true,
        result: {
          default_environment: {
            script: {
              ...(Object.hasOwn(drift, name)
                ? { migration_tag: drift[name] }
                : versions[name]?.migrationTag != null
                  ? { migration_tag: versions[name].migrationTag }
                  : {}),
            },
          },
        },
      });
    }
    const deployment = path.match(/\/workers\/scripts\/([^/]+)\/deployments$/);
    if (deployment && init.method === "POST") {
      if (failDeploy.includes(deployment[1]))
        return Response.json({ success: false }, { status: 500 });
      return Response.json({ success: true, result: {} });
    }
    if (deployment)
      return Response.json({
        success: true,
        result: {
          deployments: [{ versions: versions[deployment[1]]?.versions }],
        },
      });
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${path}`);
  };
  return { calls, fetcher };
}

test("capture stores only fixed production worker versions and migration tags", async () => {
  const api = workerApi();
  const capturedAt = "2026-10-18T12:00:00.000Z";
  const snapshot = await captureCanonicalDomainRecovery({
    accountId,
    token: "test-token",
    fetcher: api.fetcher,
    now: () => capturedAt,
  });

  assert.deepEqual(snapshot, {
    version: 1,
    accountId,
    capturedAt,
    workers: workers.map((name) => ({ name, ...versions[name] })),
  });
  assert.equal(api.calls.length, workers.length * 2);
  assert.ok(api.calls.every(({ method }) => method === "GET"));
});

test("restore rechecks lifecycle tags then restores auth, agencies, and gateway versions", async () => {
  const api = workerApi();
  const snapshot = {
    version: 1,
    accountId,
    capturedAt: "2026-10-18T12:00:00.000Z",
    workers: workers.map((name) => ({ name, ...versions[name] })),
  };

  const result = await restoreCanonicalDomainRecovery({
    snapshot,
    accountId,
    token: "test-token",
    fetcher: api.fetcher,
  });

  assert.deepEqual(result, { restored: workers });
  const deploys = api.calls.filter(({ method }) => method === "POST");
  assert.deepEqual(
    deploys.map(({ path, body }) => [
      path.match(/\/workers\/scripts\/([^/]+)\/deployments$/)?.[1],
      JSON.parse(body),
    ]),
    workers.map((name) => [
      name,
      { strategy: "percentage", versions: versions[name].versions },
    ]),
  );
});

test("restore rejects unknown workers, wrong accounts, or migration drift before deploying", async () => {
  const base = {
    version: 1,
    accountId,
    capturedAt: "2026-10-18T12:00:00.000Z",
    workers: workers.map((name) => ({ name, ...versions[name] })),
  };
  for (const [snapshot, override, pattern] of [
    [
      {
        ...base,
        workers: [
          ...base.workers.slice(0, 2),
          { ...base.workers[2], name: "other" },
        ],
      },
      {},
      /unexpected worker/,
    ],
    [base, { accountId: "abcdefabcdefabcdefabcdefabcdefab" }, /account/],
    [base, { drift: { "savia-auth": "changed" } }, /Migration tag changed/],
  ]) {
    const api = workerApi(override);
    await assert.rejects(
      restoreCanonicalDomainRecovery({
        snapshot,
        accountId,
        token: "test-token",
        fetcher: api.fetcher,
        ...override,
      }),
      pattern,
    );
    assert.equal(
      api.calls.some(({ method }) => method === "POST"),
      false,
      "validation must finish before any deployment mutation",
    );
  }
});

test("restore attempts every worker when one deployment restore fails", async () => {
  const api = workerApi({ failDeploy: ["savia-auth"] });
  const snapshot = {
    version: 1,
    accountId,
    capturedAt: "2026-10-18T12:00:00.000Z",
    workers: workers.map((name) => ({ name, ...versions[name] })),
  };

  await assert.rejects(
    restoreCanonicalDomainRecovery({
      snapshot,
      accountId,
      token: "test-token",
      fetcher: api.fetcher,
    }),
    /savia-auth/,
  );
  assert.deepEqual(
    api.calls
      .filter(({ method }) => method === "POST")
      .map(
        ({ path }) =>
          path.match(/\/workers\/scripts\/([^/]+)\/deployments$/)?.[1],
      ),
    workers,
  );
});
