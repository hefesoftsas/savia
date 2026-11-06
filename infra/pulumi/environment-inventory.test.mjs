import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryEnvironment,
  readAllPages,
} from "./environment-inventory.mjs";
const accountId = "a".repeat(32);
const row = (name, id = "b".repeat(32)) => ({
  kind: "worker",
  name,
  cloudId: id,
  accountId,
  versionId: "version-1",
});
async function inventory(
  environment,
  resources,
  checkpoints = [],
  profile = {},
) {
  return inventoryEnvironment({
    environment,
    accountId,
    profile,
    cloud: { listResources: async () => resources },
    stacks: { listCheckpoints: async () => checkpoints },
  });
}
test("Preview domain production label is not application production membership", async () => {
  const r = await inventory("preview", [
    row("savia-preview"),
    {
      kind: "domain",
      name: "savia-preview.hefesoft.com",
      cloudId: "c".repeat(40),
      accountId,
      parentWorker: "savia-preview",
      providerEnvironment: "production",
    },
  ]);
  assert.equal(r.resources.length, 2);
  assert.equal(r.environment, "preview");
  assert.equal(r.resources[1].parentWorker, "savia-preview");
  assert.equal(r.resources[1].providerEnvironment, undefined);
});
test("six-Worker branch inventory never provisions missing template resources", async () => {
  const suffix = "preview-feat-secop-tender-tracke";
  const names = [
    `savia-${suffix}`,
    ...["agencies", "auth", "request", "hook-executor", "mcp"].map(
      (n) => `savia-${n}-${suffix}`,
    ),
  ];
  let reads = 0;
  const r = await inventoryEnvironment({
    environment: "branch-feat-secop-tender-tracke",
    accountId,
    cloud: {
      listResources: async () => {
        reads++;
        return names.map((n, i) => row(n, String(i).padStart(32, "0")));
      },
    },
    stacks: { listCheckpoints: async () => [] },
  });
  assert.equal(reads, 1);
  assert.equal(r.resources.length, 6);
  assert.deepEqual(r.profile.enabledWorkers, [...names].sort());
  assert.ok(!r.profile.enabledWorkers.some((n) => n.includes("connectors")));
});
test("production absence is reported without initializing a stack", async () => {
  const r = await inventory("production", [row("savia-preview")]);
  assert.equal(r.status, "defined-not-deployed");
  assert.equal(r.resources.length, 0);
});

test("inventory records opaque-secret hosts as Worker names without retaining secret values", async () => {
  const result = await inventory("preview", [
    {
      ...row("savia-preview"),
      hasOpaqueSecrets: true,
      secretValue: "SECRET_CANARY",
    },
  ]);
  assert.deepEqual(result.profile.retentionWorkerNames, ["savia-preview"]);
  assert.equal(JSON.stringify(result).includes("SECRET_CANARY"), false);
});

test("an unrecognized attachment on an owned Worker cannot silently disappear", async () => {
  await assert.rejects(
    inventory("preview", [
      row("savia-preview"),
      {
        kind: "domain",
        name: "unexpected.hefesoft.com",
        cloudId: "d".repeat(40),
        parentWorker: "savia-preview",
      },
    ]),
    /attachment|profile/,
  );
});
test("inventories preserve IDs and annotate owning checkpoints", async () => {
  const r = await inventory(
    "preview",
    [row("savia-preview")],
    [
      {
        accountId,
        project: "savia-cloudflare",
        stack: "preview",
        resources: [row("savia-preview")],
      },
    ],
  );
  assert.equal(r.resources[0].ownerStack, "savia-cloudflare/preview");
  assert.equal(r.resources[0].cloudId, "b".repeat(32));
  assert.equal(r.resources[0].versionId, "version-1");
});
test("unrecognized Savia resources are visible but never silently adopted", async () => {
  const r = await inventory("preview", [
    row("savia-preview"),
    row("savia-qa"),
    row("secop-live-worker"),
  ]);
  assert.deepEqual(
    r.unknownResources.map((x) => x.name),
    ["savia-qa"],
  );
  assert.equal(r.resources.length, 1);
});
test("foreign account responses and multiply owned identities fail closed", async () => {
  await assert.rejects(
    inventory("preview", [
      { ...row("savia-preview"), accountId: "f".repeat(32) },
    ]),
  );
  const cp = {
    accountId,
    project: "savia-cloudflare",
    stack: "preview",
    resources: [row("savia-preview")],
  };
  await assert.rejects(
    inventory(
      "preview",
      [row("savia-preview")],
      [cp, { ...cp, stack: "other" }],
    ),
    /ownership|owned/i,
  );
});
test("all pages are read and malformed or repeated pagination is rejected", async () => {
  const calls = [];
  const values = await readAllPages(async ({ page }) => {
    calls.push(page);
    return { items: [page], page, totalPages: 3 };
  });
  assert.deepEqual(values, [1, 2, 3]);
  assert.deepEqual(calls, [1, 2, 3]);
  await assert.rejects(
    readAllPages(async () => ({ items: [], page: 1, totalPages: 0 })),
  );
  await assert.rejects(
    readAllPages(async () => ({ items: [], page: 1, totalPages: 2 })),
    /pagination|page/i,
  );
});

test("Preview checkpoint database outputs are observed names, not production overrides", async () => {
  const databaseNames = {
    auth: "savia-auth-preview",
    domain: "savia-agencies-preview",
  };
  const resources = Object.values(databaseNames).map((name, index) => ({
    kind: "d1",
    name,
    cloudId: `123e4567-e89b-42d3-a456-42661417400${index}`,
    accountId,
  }));
  const result = await inventory("preview", resources, [], { databaseNames });
  assert.deepEqual(result.profile.databaseNames, databaseNames);
  assert.deepEqual(
    result.resources.map((row) => row.name).sort(),
    Object.values(databaseNames).sort(),
  );
  for (const invalid of [
    { ...databaseNames, auth: "savia-auth" },
    { ...databaseNames, domain: "savia-agencies" },
    { auth: databaseNames.domain, domain: databaseNames.auth },
  ]) {
    await assert.rejects(
      inventory("preview", resources, [], { databaseNames: invalid }),
      /Preview database profile/,
    );
  }
});
