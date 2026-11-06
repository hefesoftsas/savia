import { it, expect } from "vitest";
import { operations } from "../src/domain";
import { extension } from "../src/manifest";
it("registers each carrier operation without claiming built-in insurer support", () => {
  expect(extension.runtime.actions.map((a) => a.actionId)).toEqual(
    operations.map((o) => o.value),
  );
  expect(extension.runtime.connectors[0].secretFields).toEqual(["token"]);
});
it("recovers the exact operation reference and rejects mismatched or malformed saved intents", async () => {
  const { parseIntent, createIntent } = await import("../src/domain");
  const intent = createIntent(
    "request-issuance",
    "P-1",
    "carrier",
    "main",
    "stable-operation-key",
  );
  expect(parseIntent(JSON.stringify(intent))).toEqual(intent);
  expect(() =>
    parseIntent(JSON.stringify({ ...intent, operation: "delete" })),
  ).toThrow();
  expect(() =>
    createIntent(
      "request-issuance",
      "",
      "carrier",
      "main",
      "stable-operation-key",
    ),
  ).toThrow();
  expect(parseIntent(JSON.stringify(intent)).operationKey).toBe(
    "stable-operation-key",
  );
});
