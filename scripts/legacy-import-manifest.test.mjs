import assert from "node:assert/strict";
import test from "node:test";

import {
  compareManifest,
  validateManifest,
} from "./legacy-import-manifest.mjs";

const stream = {
  sourceType: "surreal",
  sourceName: "core:agency",
  destinationPrefix: "legacy-import/snapshot-1/core/agency",
  records: 1,
  bytes: 9,
  sha256: "a".repeat(64),
};

const manifest = {
  snapshotId: "snapshot-1",
  createdAt: "2026-09-02T00:00:00.000Z",
  streams: [stream],
};

test("rejects a manifest with duplicate source streams", () => {
  assert.throws(
    () =>
      validateManifest({
        ...manifest,
        streams: [
          stream,
          {
            ...stream,
            destinationPrefix: "legacy-import/snapshot-1/core/agency-2",
            sha256: "b".repeat(64),
          },
        ],
      }),
    /duplicate/,
  );
});

test("reports stream differences without accepting a partial snapshot", () => {
  assert.deepEqual(compareManifest(manifest, manifest), {
    matches: true,
    mismatches: [],
  });
  assert.deepEqual(
    compareManifest(manifest, {
      ...manifest,
      streams: [{ ...stream, records: 2 }],
    }),
    {
      matches: false,
      mismatches: ["stream surreal:core:agency records differ"],
    },
  );
});
