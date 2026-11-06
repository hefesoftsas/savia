import assert from "node:assert/strict";
import test from "node:test";

import { runReplacement } from "./cloudflare-replacement.mjs";

test("does not call the command runner for a mutation without --apply", async () => {
  const calls = [];

  await assert.rejects(
    () =>
      runReplacement("provision", {
        apply: false,
        run: async (...args) => calls.push(args),
      }),
    /requires --apply/,
  );

  assert.deepEqual(calls, []);
});

test("invents no resources while inventory is read-only", async () => {
  const calls = [];

  await runReplacement("inventory", {
    apply: false,
    run: async (...args) => {
      calls.push(args);
      return { stdout: "[]", stderr: "" };
    },
  });

  assert.deepEqual(
    calls.map(([command]) => command),
    ["deployments", "d1", "r2", "kv", "queues", "pages"],
  );
  assert.equal(
    calls.some(([, subcommand]) =>
      ["create", "delete", "deploy"].includes(subcommand),
    ),
    false,
  );
});
