import { describe, expect, it } from "vitest";
import { extractTrigger } from "./trigger";

const event = {
  id: "evt-1",
  tenant: "tenant:one",
  collection: "Tasks",
  operation: "updated" as const,
  recordId: "rec-1",
  recordVersion: 2,
  timestamp: "2026-10-12T10:00:00.000Z",
  before: { status: "open" },
  after: { status: "done" },
  changedFields: ["status"],
  actor: { kind: "user", id: "user-1" },
};

describe("extractTrigger", () => {
  it("preserves an authorized Savia collection event for downstream nodes", () => {
    expect(extractTrigger({ saviaCollectionEvent: event })).toEqual({
      saviaCollectionEvent: event,
    });
  });
});
