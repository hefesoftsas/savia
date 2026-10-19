import assert from "node:assert/strict";
import test from "node:test";
import { resolveEnvironment } from "./environments.mjs";
import {
  validateAdoptionManifest,
  assertAdoptionPlan,
  adoptionManifestHash,
} from "./environment-manifest.mjs";
const accountId = "a".repeat(32);
const worker = (name = "savia-preview") => ({
  kind: "worker",
  name,
  cloudId: "b".repeat(32),
  ownerStack: null,
  parentWorker: null,
});
function manifest(environment = "preview", resources = [worker()]) {
  const e = resolveEnvironment(environment);
  return {
    version: 1,
    accountId,
    environment,
    project: e.project,
    stack: e.stack,
    profile: {},
    resources,
  };
}
function validate(m, checkpoints = []) {
  return validateAdoptionManifest(m, {
    environment: m.environment,
    accountId,
    checkpoints,
  });
}

test("retention metadata may name only Workers present in the same manifest", () => {
  const good = {
    ...manifest(),
    profile: { retentionWorkerNames: ["savia-preview"] },
  };
  assert.deepEqual(validate(good).profile.retentionWorkerNames, [
    "savia-preview",
  ]);
  assert.throws(
    () =>
      validate({
        ...good,
        profile: { retentionWorkerNames: ["savia-auth-preview"] },
      }),
    /retention|Retained/,
  );
  assert.throws(
    () =>
      validate({
        ...good,
        profile: { retentionWorkerNames: ["other-product"] },
      }),
    /retention|Retained/,
  );
});
test("environment resolution never defaults and preserves project boundaries", () => {
  assert.throws(() => resolveEnvironment(undefined));
  assert.throws(() => resolveEnvironment("qa"));
  assert.equal(resolveEnvironment("preview").project, "savia-cloudflare");
  assert.equal(resolveEnvironment("production").stack, "production");
  assert.equal(resolveEnvironment("shared").project, "savia-shared-registry");
  assert.equal(resolveEnvironment("management").kind, "management");
  assert.equal(
    resolveEnvironment("branch-feat-secop-tender-tracke").project,
    "savia-branch-preview",
  );
  for (const id of [
    "branch-main",
    "branch-../preview",
    "branch-UPPER",
    "branch-too-long-branch-slug-exceeds-24",
  ])
    assert.throws(() => resolveEnvironment(id));
});
test("exact resource identities are validated and returned immutable", () => {
  const value = validate(manifest());
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.resources));
  assert.ok(Object.isFrozen(value.resources[0]));
  for (const name of [
    "savia",
    "savia-qa",
    "savia-providers",
    "savia-plugin-registry",
    "savia-nocobase-r2-secure-dev",
    "savia-preview-extra",
  ])
    assert.throws(() => validate(manifest("preview", [worker(name)])));
  assert.throws(() => validate({ ...manifest(), accountId: "c".repeat(32) }));
  assert.throws(() => validate({ ...manifest(), project: "savia-management" }));
  assert.throws(() =>
    validate(manifest("preview", [{ ...worker(), cloudId: "../../foreign" }])),
  );
});
test("adoption rejects duplicate ownership across checkpoints and allows its own", () => {
  const row = worker();
  const own = {
    accountId,
    project: "savia-cloudflare",
    stack: "preview",
    resources: [row],
  };
  validate(manifest(), [own]);
  const other = { ...own, project: "other", stack: "other" };
  assert.throws(() => validate(manifest(), [other]), /owned|ownership/i);
  assert.throws(() => validate(manifest(), [own, other]), /owned|ownership/i);
  assert.throws(() => validate(manifest("preview", [row, { ...row }])));
});
test("attached resources must belong to an included worker and correct environment", () => {
  const root = worker();
  const domain = {
    kind: "domain",
    name: "savia-preview.hefesoft.com",
    cloudId: "d".repeat(40),
    ownerStack: null,
    parentWorker: root.name,
  };
  validate(manifest("preview", [root, domain]));
  assert.throws(() => validate(manifest("preview", [domain])));
  assert.throws(() =>
    validate(
      manifest("preview", [root, { ...domain, name: "savia.hefesoft.com" }]),
    ),
  );
  assert.throws(() =>
    validate(manifest("preview", [root, { ...domain, parentWorker: "savia" }])),
  );
  assert.throws(() =>
    validate(manifest("preview", [{ ...root, dependencies: ["savia-auth"] }])),
  );
});
test("shared and management cannot be adopted into disposable environments", () => {
  const bucket = {
    kind: "r2",
    name: "savia-pulumi-state-preview",
    cloudId: "savia-pulumi-state-preview",
    ownerStack: null,
    parentWorker: null,
  };
  assert.throws(() => validate(manifest("preview", [bucket])));
  validate(manifest("management", [bucket]));
  validate(
    manifest("shared", [
      {
        ...bucket,
        name: "savia-plugin-registry",
        cloudId: "savia-plugin-registry",
      },
    ]),
  );
});
test("secrets and arbitrary payloads cannot enter adoption metadata", () => {
  for (const key of [
    "token",
    "secret",
    "variables",
    "content",
    "credentials",
  ]) {
    assert.throws(() =>
      validate({ ...manifest(), [key]: "must-not-be-copied" }),
    );
    assert.throws(() =>
      validate(
        manifest("preview", [{ ...worker(), [key]: "must-not-be-copied" }]),
      ),
    );
  }
  assert.throws(() =>
    validate({ ...manifest(), profile: { apiToken: "hidden" } }),
  );
});
test("adoption plan allows only reviewed identity imports and read-only bookkeeping", () => {
  const m = validate(manifest());
  assertAdoptionPlan(
    {
      steps: [
        {
          op: "import",
          kind: "worker",
          name: "savia-preview",
          cloudId: "b".repeat(32),
        },
        { op: "create", type: "pulumi:pulumi:Stack" },
      ],
    },
    m,
  );
  assertAdoptionPlan(
    {
      steps: [
        {
          op: "create",
          type: "savia:runtime:RuntimeRelease",
          mode: "adopt",
          environment: m.environment,
          accountId,
          manifestHash: adoptionManifestHash(m),
        },
      ],
    },
    m,
  );
  for (const op of [
    "create",
    "update",
    "delete",
    "replace",
    "create-replacement",
    "import-replacement",
  ])
    assert.throws(() =>
      assertAdoptionPlan(
        { steps: [{ op, kind: "worker", name: "savia-preview" }] },
        m,
      ),
    );
  assert.throws(() =>
    assertAdoptionPlan(
      {
        steps: [
          {
            op: "import",
            kind: "worker",
            name: "savia",
            cloudId: "b".repeat(32),
          },
        ],
      },
      m,
    ),
  );
  assert.throws(() =>
    assertAdoptionPlan(
      {
        steps: [
          {
            op: "create",
            type: "savia:runtime:RuntimeRelease",
            mode: "release",
          },
        ],
      },
      m,
    ),
  );
  assert.throws(() =>
    assertAdoptionPlan(
      {
        steps: [
          {
            op: "create",
            type: "savia:runtime:RuntimeRelease",
            mode: "adopt",
            environment: "production",
            accountId,
            manifestHash: adoptionManifestHash(m),
          },
        ],
      },
      m,
    ),
  );
  assert.throws(
    () => assertAdoptionPlan({ changeSummary: { same: 1 } }, m),
    /steps|detail/i,
  );
});
test("native identities cannot pretend to be Worker attachments or omit internal dependencies", () => {
  assert.throws(() =>
    validate(
      manifest("preview", [{ ...worker(), parentWorker: "savia-preview" }]),
    ),
  );
  assert.throws(() =>
    validate(
      manifest("preview", [
        { ...worker(), dependencies: ["savia-auth-preview"] },
      ]),
    ),
  );
});

test("adoption may update only the selected stack's bookkeeping outputs", () => {
  const manifest = {
    accountId: "a".repeat(32),
    environment: "preview",
    project: "savia-cloudflare",
    stack: "preview",
    resources: [],
  };
  assert.equal(
    assertAdoptionPlan(
      {
        steps: [
          {
            op: "update",
            type: "pulumi:pulumi:Stack",
            urn: "urn:pulumi:preview::savia-cloudflare::pulumi:pulumi:Stack::savia-cloudflare-preview",
          },
        ],
      },
      manifest,
    ),
    true,
  );
  assert.throws(() =>
    assertAdoptionPlan(
      {
        steps: [
          {
            op: "update",
            type: "pulumi:pulumi:Stack",
            urn: "urn:pulumi:production::savia-cloudflare::pulumi:pulumi:Stack::savia-cloudflare-production",
          },
        ],
      },
      manifest,
    ),
  );
});

test("cron names are unique per Worker while physical identities stay unique", () => {
  const workers = [
    worker("savia-agencies-preview"),
    { ...worker("savia-flows-preview"), cloudId: "c".repeat(32) },
  ];
  const crons = workers.map((parent) => ({
    kind: "cron",
    name: "* * * * *",
    cloudId: `${parent.name}/* * * * *`,
    parentWorker: parent.name,
  }));
  const observed = manifest("preview", [...workers, ...crons]);
  assert.equal(validate(observed).resources.length, 4);
  assert.throws(
    () =>
      validate(
        manifest("preview", [
          ...workers,
          ...crons,
          { ...crons[0], cloudId: "d".repeat(32) },
        ]),
      ),
    /Duplicate resource identity/,
  );
  assert.throws(
    () =>
      validate(
        manifest("preview", [
          ...workers,
          crons[0],
          { ...crons[1], cloudId: crons[0].cloudId },
        ]),
      ),
    /Duplicate resource identity|outside environment/,
  );
});
