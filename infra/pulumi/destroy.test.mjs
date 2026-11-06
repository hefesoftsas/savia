import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseDestroyArgs,
  assertStackMatches,
  r2BucketsForDestroy,
  emptyBucketForDestroy,
  buildPulumiDestroyArgs,
} from "./destroy.mjs";

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
    assert.throws(() => parseDestroyArgs(["--stack", "production", "--apply"]));
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

  it("refuses stacks resolving to another environment", () => {
    assertStackMatches(
      { resolvedEnvironment: "preview", documentsBucketName: "docs" },
      { stack: "preview", environment: "preview" },
    );
    assert.throws(() =>
      assertStackMatches(
        { resolvedEnvironment: "production" },
        { stack: "preview", environment: "preview" },
      ),
    );
  });

  it("application destroy cannot target the independent management stack", () => {
    assert.throws(() => buildPulumiDestroyArgs("management", true));
    const args = buildPulumiDestroyArgs("preview", true);
    assert.deepEqual(args, ["destroy", "--stack", "preview", "--yes"]);
    assert.deepEqual(buildPulumiDestroyArgs("preview", false), [
      "destroy",
      "--stack",
      "preview",
      "--yes",
    ]);
    assert.throws(
      () =>
        assertStackMatches(
          {
            resolvedEnvironment: "preview",
            stateBackendBucketName: "savia-documents-preview",
            documentsBucketName: "savia-documents-preview",
          },
          { stack: "preview", environment: "preview" },
        ),
      /state backend cannot be a data bucket/,
    );
    assert.deepEqual(
      r2BucketsForDestroy({
        documentsBucketName: "savia-documents-preview",
        flowsEnabled: false,
        flowsResources: null,
      }),
      ["savia-documents-preview"],
    );
    const flowsOutputs = {
      documentsBucketName: "savia-documents-preview",
      flowsEnabled: true,
      flowsResources: {
        buckets: {
          resources: "savia-flows-resources-preview",
          datasets: "savia-flows-datasets-preview",
          inboxes: "savia-flows-inboxes-preview",
        },
      },
    };
    assert.deepEqual(r2BucketsForDestroy(flowsOutputs), [
      "savia-documents-preview",
      "savia-flows-resources-preview",
      "savia-flows-datasets-preview",
      "savia-flows-inboxes-preview",
    ]);
    assert.throws(
      () =>
        assertStackMatches(
          {
            ...flowsOutputs,
            stateBackendBucketName: "savia-flows-resources-preview",
            resolvedEnvironment: "preview",
          },
          { stack: "preview", environment: "preview" },
        ),
      /state backend cannot be a data bucket/,
    );
  });

  it("uses the paginated Cloudflare API to empty every R2 object and fails closed", async () => {
    const calls = [];
    let deleted = false;
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (options.method === "DELETE") {
        deleted = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, result: { key: "a.txt" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: deleted ? [] : [{ key: "a.txt" }],
          result_info: { is_truncated: false },
        }),
      };
    };
    assert.equal(
      await emptyBucketForDestroy({
        bucket: "bucket",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        token: "redacted",
        fetchImpl,
      }),
      1,
    );
    assert.equal(calls.length, 3);
    assert.equal(calls[1].options.method, "DELETE");
    assert.match(calls[0].url, /\/objects\?/);

    await assert.rejects(
      emptyBucketForDestroy({
        bucket: "bucket",
        accountId: "08a0d36f8b0357684f83e4bfeb6628b6",
        token: "redacted",
        fetchImpl: async () => ({
          ok: false,
          status: 403,
          json: async () => ({ success: false }),
        }),
      }),
      /R2 list failed/,
    );
  });
});
