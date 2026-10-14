import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesPinnedDigest } from "./verify-source.mjs";

test("source verification accepts only imported or documented adaptation digests", () => {
  const file = {
    importedSha256: "pinned-upstream-content",
    adaptations: [
      {
        sha256: "documented-adaptation",
        reason: "The runtime metadata documents the QuickJS guest.",
      },
    ],
  };

  assert.equal(matchesPinnedDigest(file, "pinned-upstream-content"), true);
  assert.equal(matchesPinnedDigest(file, "documented-adaptation"), true);
  assert.equal(matchesPinnedDigest(file, "unreviewed-edit"), false);
  assert.equal(
    matchesPinnedDigest(
      { ...file, adaptations: [{ sha256: "unreviewed-edit", reason: " " }] },
      "unreviewed-edit",
    ),
    false,
  );
});
