import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  resetLocalState,
  resolveLocalStateReset,
} from "./reset-savia-local-state.mjs";

const stateDirectories = [
  "apps/api/.wrangler/state",
  "apps/auth/.wrangler/state",
  "apps/savia-request/.wrangler/state",
];

test("plans and confirms a reset of only Savia local runtime state", async () => {
  const repository = await mkdtemp(join(tmpdir(), "savia-local-state-"));
  try {
    for (const directory of stateDirectories) {
      const target = resolve(repository, directory);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "state.sqlite"), "local test state");
    }
    await mkdir(resolve(repository, "infra/secrets"), { recursive: true });
    await writeFile(resolve(repository, "infra/secrets/keep.env"), "secret");

    const plan = resolveLocalStateReset(repository);
    assert.deepEqual(
      plan.targets,
      stateDirectories.map((directory) => resolve(repository, directory)),
    );

    await resetLocalState(plan);
    await assert.doesNotReject(() =>
      writeFile(
        resolve(repository, "apps/api/.wrangler/state/preview-kept"),
        "ok",
      ),
    );

    await resetLocalState(plan, { confirmed: true });
    for (const target of plan.targets)
      await assert.rejects(() => writeFile(join(target, "gone"), "no"));
    assert.equal(
      await readFile(resolve(repository, "infra/secrets/keep.env"), "utf8"),
      "secret",
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
