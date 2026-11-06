import assert from "node:assert/strict";
import test from "node:test";
import { coverageIssues, mergeCoverage } from "./coverage.mjs";

const projects = [{ path: "apps/example" }];
const status = (shard, exitCode = 0) => ({
  project: "apps/example",
  shard,
  exitCode,
  hasReport: true,
});

test("a total requires every project and every shard to finish successfully", () => {
  assert.deepEqual(
    coverageIssues(projects, [status("1/2"), status("2/2")]),
    [],
  );
  assert.ok(coverageIssues(projects, [status("1/2")]).length);
  assert.ok(coverageIssues(projects, [status("full", 1)]).length);
  assert.ok(coverageIssues(projects, []).length);
  assert.ok(
    coverageIssues(projects, [{ ...status("full"), hasReport: false }]).length,
  );
  assert.ok(
    coverageIssues(projects, [status("full"), status("1/2"), status("2/2")])
      .length,
  );
});

test("merging shards combines hits before calculating percentages", () => {
  const file = (hits) => ({
    path: "/repo/src/example.ts",
    statementMap: {
      0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      1: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
    },
    fnMap: {},
    branchMap: {},
    s: { 0: hits[0], 1: hits[1] },
    f: {},
    b: {},
  });
  const merged = mergeCoverage([
    { "/repo/src/example.ts": file([1, 0]) },
    { "/repo/src/example.ts": file([0, 1]) },
  ]);
  assert.equal(merged.getCoverageSummary().statements.pct, 100);
  assert.equal(merged.getCoverageSummary().statements.total, 2);
});

test("reports from a different source snapshot are rejected", () => {
  const current = { ...status("full"), fingerprint: "current" };
  assert.deepEqual(coverageIssues(projects, [current], "current"), []);
  assert.ok(coverageIssues(projects, [current], "changed-source").length);
  assert.ok(coverageIssues(projects, [status("full")], "current").length);
});
