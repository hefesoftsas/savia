import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summarizePerfEntries,
  summarizeRequests,
  totpNow,
} from "./measure-navigation.mjs";

describe("navigation-perf aggregation", () => {
  it("groups requests per endpoint and sums API time", () => {
    const { byEndpoint, apiMs } = summarizeRequests([
      { method: "GET", url: "http://x/api/bootstrap", durationMs: 40 },
      { method: "GET", url: "http://x/api/bootstrap", durationMs: 10 },
      { method: "GET", url: "http://x/assets/index-abc.js", durationMs: 5 },
    ]);
    assert.equal(byEndpoint["GET /api/bootstrap"], 2);
    assert.equal(byEndpoint["GET /assets/index-abc.js"], 1);
    assert.equal(apiMs, 50);
  });

  it("sums downloaded JS modules", () => {
    const { jsBytes } = summarizePerfEntries([
      { entryType: "resource", name: "a.js", transferSize: 100 },
      { entryType: "resource", name: "b.css", transferSize: 999 },
    ]);
    assert.equal(jsBytes, 100);
  });

  it("computes stable TOTP codes per 30s window", () => {
    const at = 1_790_359_600_000;
    assert.equal(
      totpNow("test-secret", at),
      totpNow("test-secret", at + 10_000),
    );
    assert.match(totpNow("test-secret", at), /^\d{6}$/);
    assert.notEqual(totpNow("test-secret", at), totpNow("other-secret", at));
  });
});
