import assert from "node:assert/strict";
import test from "node:test";
import { assertPreviewDatabase } from "./verify-preview-resources.mjs";
test("preview deployment rejects a production database even if a variable points to it", () => {
  assert.throws(
    () =>
      assertPreviewDatabase(
        { name: "savia-agencies", uuid: "prod-id" },
        "savia-agencies-preview",
        "prod-id",
      ),
    /isolated preview/,
  );
  assert.throws(
    () =>
      assertPreviewDatabase(
        { name: "savia-agencies-preview", uuid: "wrong" },
        "savia-agencies-preview",
        "expected",
      ),
    /isolated preview/,
  );
  assert.doesNotThrow(() =>
    assertPreviewDatabase(
      { name: "savia-agencies-preview", uuid: "preview-id" },
      "savia-agencies-preview",
      "preview-id",
    ),
  );
});
