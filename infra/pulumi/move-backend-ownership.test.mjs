import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planBackendOwnershipMove,
  moveBackendOwnership,
} from "./move-backend-ownership.mjs";
import { stateBackendUrl } from "./naming.mjs";
const accountId = "a".repeat(32),
  source = "organization/savia-cloudflare/preview",
  destination = "organization/savia-management/management";
const backendUrn =
  "urn:pulumi:preview::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::state-backend";
const backend = {
  urn: backendUrn,
  type: "cloudflare:index/r2Bucket:R2Bucket",
  id: `${accountId}/savia-pulumi-state-preview/default`,
  protect: true,
  inputs: { accountId, name: "savia-pulumi-state-preview" },
  outputs: { accountId, name: "savia-pulumi-state-preview" },
};
function fixtures() {
  return [source, destination].map((stack, index) => ({
    stack,
    accountId,
    backendUrl: stateBackendUrl(accountId, "savia-pulumi-state-preview"),
    stateExport: {
      version: 3,
      deployment: { resources: index ? [] : [structuredClone(backend)] },
    },
  }));
}
const makePlan = (checkpoints = fixtures()) =>
  planBackendOwnershipMove({ source, destination, backendUrn, checkpoints });
test("backend move accepts one protected bucket and rejects unsettled or duplicate custody", () => {
  const plan = makePlan();
  assert.equal(plan.backendUrn, backendUrn);
  assert.equal(plan.source, source);
  assert.equal(plan.destination, destination);
  for (const mutate of [
    (rows) => (rows[0].stateExport.deployment.pending_operations = [{}]),
    (rows) => (rows[0].stateExport.deployment.resources[0].protect = false),
    (rows) =>
      rows[1].stateExport.deployment.resources.push(structuredClone(backend)),
    (rows) => (rows[0].accountId = "b".repeat(32)),
  ]) {
    const rows = fixtures();
    mutate(rows);
    assert.throws(() => makePlan(rows));
  }
  assert.throws(() =>
    planBackendOwnershipMove({
      source,
      destination,
      backendUrn: backendUrn.replace("state-backend", "documents"),
      checkpoints: fixtures(),
    }),
  );
});
test("move is read-only by default and mutation requires verified workflow freeze", async () => {
  const plan = makePlan();
  let calls = 0;
  assert.equal(
    (await moveBackendOwnership(plan, { run: async () => calls++ })).applied,
    false,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    moveBackendOwnership(plan, { apply: true, run: async () => calls++ }),
    /freeze/i,
  );
  assert.equal(calls, 0);
});
test("interrupted move retains private exports/configuration and never attempts another mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-move-test-"));
  try {
    const checkpoints = fixtures(),
      plan = makePlan(checkpoints),
      calls = [];
    const freeze = join(directory, "freeze.json");
    await writeFile(
      freeze,
      JSON.stringify({
        version: 1,
        frozen: true,
        workflows: [{ id: 1, currentState: "disabled_manually" }],
        inFlight: [],
      }),
    );
    const configFiles = {};
    for (const stack of [source, destination]) {
      configFiles[stack] = join(
        directory,
        stack === source ? "preview.yaml" : "management.yaml",
      );
      await writeFile(configFiles[stack], "encrypted config fixture");
    }
    const run = async (_binary, args) => {
      calls.push(args);
      if (args[0] === "state") throw new Error("injected interruption");
      return {
        stdout: JSON.stringify(
          checkpoints.find((row) => row.stack === args.at(-1)).stateExport,
        ),
      };
    };
    const journalDir = join(directory, "journal");
    await assert.rejects(
      moveBackendOwnership(plan, {
        apply: true,
        run,
        journalDir,
        configurationFiles: configFiles,
        env: { PULUMI_BACKEND_URL: plan.backendUrl },
        freezeJournal: freeze,
        verifyFrozen: async () => true,
      }),
      /snapshots-written/,
    );
    assert.equal(calls.filter((args) => args[0] === "state").length, 1);
    assert.equal(
      calls.some(
        (args) =>
          args.includes("rm") ||
          args.includes("up") ||
          args.includes("destroy"),
      ),
      false,
    );
    const journal = JSON.parse(
      await readFile(join(journalDir, "journal.json"), "utf8"),
    );
    assert.equal(journal.stage, "snapshots-written");
    assert.equal(
      await readFile(join(journalDir, "source.config.yaml"), "utf8"),
      "encrypted config fixture",
    );
    assert.ok(
      JSON.parse(await readFile(join(journalDir, "source.before.json"), "utf8"))
        .deployment,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("successful move changes only backend custody and retains its physical identity/protection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-move-success-"));
  try {
    const checkpoints = fixtures(),
      plan = makePlan(checkpoints);
    let moved = false;
    const calls = [];
    const freeze = join(directory, "freeze.json");
    await writeFile(
      freeze,
      JSON.stringify({
        version: 1,
        frozen: true,
        workflows: [{ id: 1, currentState: "disabled_manually" }],
        inFlight: [],
      }),
    );
    const configurationFiles = {};
    for (const stack of [source, destination]) {
      configurationFiles[stack] = join(
        directory,
        stack === source ? "preview.yaml" : "management.yaml",
      );
      await writeFile(configurationFiles[stack], "encrypted config");
    }
    const run = async (_binary, args) => {
      calls.push(args);
      if (args[0] === "state") {
        moved = true;
        return { stdout: "moved" };
      }
      const stateExport = structuredClone(
        checkpoints.find((row) => row.stack === args.at(-1)).stateExport,
      );
      if (moved)
        stateExport.deployment.resources =
          args.at(-1) === source
            ? []
            : [
                {
                  ...backend,
                  urn: backendUrn.replace(
                    "urn:pulumi:preview::savia-cloudflare::",
                    "urn:pulumi:management::savia-management::",
                  ),
                },
              ];
      return { stdout: JSON.stringify(stateExport) };
    };
    const result = await moveBackendOwnership(plan, {
      apply: true,
      run,
      journalDir: join(directory, "journal"),
      configurationFiles,
      env: { PULUMI_BACKEND_URL: plan.backendUrl },
      freezeJournal: freeze,
      verifyFrozen: async () => true,
    });
    assert.equal(result.stage, "verified");
    assert.equal(calls.filter((args) => args[0] === "state").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backend transfer accepts a genuinely empty initialized destination export", () => {
  const rows = fixtures();
  rows[1].stateExport = {
    version: 3,
    deployment: { manifest: {}, metadata: {} },
  };
  assert.equal(makePlan(rows).destination, destination);
});
