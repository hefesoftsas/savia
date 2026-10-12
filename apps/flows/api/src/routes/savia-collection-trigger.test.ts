import { describe, expect, it } from "vitest";
import { matchesSaviaCollectionSubscription } from "./savia-collection-trigger";
import type { SaviaCollectionEvent } from "@savia/studio-shared/savia-flows";

const event: SaviaCollectionEvent = {
  id: "event-1",
  tenant: "tenant:one",
  collection: "Tasks",
  operation: "updated",
  recordId: "record-1",
  recordVersion: 2,
  timestamp: "2026-10-12T10:00:00.000Z",
  before: { status: "open", title: "A" },
  after: { status: "done", title: "A" },
  changedFields: ["status"],
  actor: { kind: "user", id: "user-1" },
};

describe("matchesSaviaCollectionSubscription", () => {
  const base = {
    collection: "Tasks",
    operations: ["updated"],
    ignoreOwnChanges: true,
  } as const;
  it("requires a watched field to have changed and evaluates equality against its chosen snapshot", () => {
    expect(
      matchesSaviaCollectionSubscription(
        event,
        {
          ...base,
          watchedFields: ["status"],
          conditions: [{ field: "status", source: "before", equals: "open" }],
        },
        "tenant:one",
        "flow-1",
      ),
    ).toBe(true);
    expect(
      matchesSaviaCollectionSubscription(
        event,
        { ...base, watchedFields: ["title"] },
        "tenant:one",
        "flow-1",
      ),
    ).toBe(false);
    expect(
      matchesSaviaCollectionSubscription(
        event,
        {
          ...base,
          conditions: [{ field: "status", source: "after", equals: "open" }],
        },
        "tenant:one",
        "flow-1",
      ),
    ).toBe(false);
  });
  it("rejects tenant mismatches and own causal changes", () => {
    expect(
      matchesSaviaCollectionSubscription(event, base, "tenant:other", "flow-1"),
    ).toBe(false);
    expect(
      matchesSaviaCollectionSubscription(
        {
          ...event,
          cause: { rootEventId: "event-1", workflowIds: ["flow-1"], depth: 1 },
        },
        base,
        "tenant:one",
        "flow-1",
      ),
    ).toBe(false);
  });
  it("stops causal chains at depth eight", () => {
    expect(
      matchesSaviaCollectionSubscription(
        {
          ...event,
          cause: { rootEventId: "event-1", workflowIds: [], depth: 8 },
        },
        base,
        "tenant:one",
        "flow-1",
      ),
    ).toBe(false);
  });
});
