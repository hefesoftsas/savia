import test from "node:test";
import assert from "node:assert/strict";
import { runStandardDeploy } from "./runtime-deploy-schedule.mjs";
import { standardReleaseCommands } from "./runtime-publisher-standard.mjs";

const plan = () =>
  standardReleaseCommands({
    environment: "preview",
    desiredFlows: true,
    flowsPolicyGeneration: 2,
    configs: Object.fromEntries(
      [
        "auth",
        "mcp",
        "hookExecutor",
        "flows",
        "api",
        "request",
        "connectors",
        "pluginEditor",
        "gateway",
      ].map((role) => [role, `/f/${role}.json`]),
    ),
    recoveryDirectory: "/private/recovery",
  }).deploy;
const id = (step) =>
  step.worker ?? (step.kind === "node" ? "auth-init" : "editor-verify");

test("Preview publishes independent Workers with at most two in flight and dependency barriers", async () => {
  let active = 0,
    maximum = 0;
  const completed = new Set();
  const dependencies = {
    "auth-init": ["auth"],
    mcp: ["auth-init"],
    hookExecutor: ["auth-init"],
    pluginEditor: ["auth-init"],
    "editor-verify": ["pluginEditor"],
    flows: ["hookExecutor"],
    request: ["hookExecutor"],
    connectors: ["request"],
    api: ["auth-init", "mcp", "flows", "request", "connectors"],
    gateway: ["api", "editor-verify"],
  };
  await runStandardDeploy(
    plan(),
    async (step) => {
      const name = id(step);
      for (const dependency of dependencies[name] ?? [])
        assert.ok(completed.has(dependency), `${name} before ${dependency}`);
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      completed.add(name);
    },
    "preview",
  );
  assert.equal(maximum, 2);
  assert.equal(completed.size, plan().length);
});

test("failure waits for in-flight publications before rejecting and starts no dependent work", async () => {
  let settleHook;
  const hook = new Promise((resolve) => {
    settleHook = resolve;
  });
  const started = [];
  const failure = new Error("publish failed");
  let returned = false;
  const publishing = runStandardDeploy(
    plan(),
    async (step) => {
      started.push(id(step));
      if (step.worker === "mcp") throw failure;
      if (step.worker === "hookExecutor") await hook;
    },
    "preview",
  ).finally(() => {
    returned = true;
  });
  const rejected = assert.rejects(publishing, (error) => error === failure);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(returned, false);
  assert.deepEqual(started, ["auth", "auth-init", "mcp", "hookExecutor"]);
  settleHook();
  await rejected;
  assert.deepEqual(started, ["auth", "auth-init", "mcp", "hookExecutor"]);
});

test("Production and unrecognized commands preserve the existing serial order", async () => {
  for (const [environment, steps] of [
    ["production", plan()],
    ["preview", [...plan(), { kind: "unknown" }]],
  ]) {
    let active = 0;
    const visited = [];
    await runStandardDeploy(
      steps,
      async (step) => {
        assert.equal(++active, 1);
        visited.push(step);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
      },
      environment,
    );
    assert.deepEqual(visited, steps);
  }
});
