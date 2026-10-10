import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDestroyArgs } from "./destroy.mjs";

describe("pulumi destroy guards", () => {
  it("plans preview destroy with --dry-run", () => {
    const plan = parseDestroyArgs(["--stack", "preview", "--dry-run"]);
    assert.equal(plan.environment, "preview");
    assert.equal(plan.dryRun, true);
  });

  it("requires --apply to execute", () => {
    assert.throws(() => parseDestroyArgs(["--stack", "preview"]));
    const plan = parseDestroyArgs(["--stack", "preview", "--apply"]);
    assert.equal(plan.dryRun, false);
  });

  it("refuses production without explicit acknowledgement", () => {
    assert.throws(() =>
      parseDestroyArgs(["--stack", "production", "--apply"]),
    );
    const plan = parseDestroyArgs([
      "--stack",
      "production",
      "--apply",
      "--i-understand-destroy-production",
    ]);
    assert.equal(plan.environment, "production");
  });

  it("rejects unknown stacks", () => {
    assert.throws(() => parseDestroyArgs(["--stack", "qa", "--dry-run"]));
    assert.throws(() => parseDestroyArgs(["--dry-run"]));
  });
});
