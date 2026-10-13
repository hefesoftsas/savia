import type { Node } from "@savia/flows-types";
import type { NodeContext } from "@savia/flows-runtime";
import type { SaviaCollectionEvent } from "@savia/studio-shared/savia-flows";
import { describe, expect, it } from "vitest";
import { SaviaCollectionEventNode } from "./collection-nodes";

const event: SaviaCollectionEvent = {
  id: "event-1",
  tenant: "tenant-1",
  collection: "Tasks",
  operation: "updated",
  recordId: "task-1",
  recordVersion: 2,
  timestamp: "2026-10-13T12:00:00.000Z",
  before: { status: "open" },
  after: { status: "done" },
  changedFields: ["status"],
  actor: { kind: "user", id: "user-1" },
};

function node(): SaviaCollectionEventNode {
  return new SaviaCollectionEventNode({
    id: "collection-event-node",
    type: "savia-collection-event",
  } as Node);
}

describe("SaviaCollectionEventNode", () => {
  it("keeps the singular event and exposes a batch events array and count", async () => {
    const events = [event, { ...event, id: "event-2" }];
    const result = await node().execute({
      saviaCollectionEvent: event,
      saviaCollectionEvents: events,
    } as NodeContext);

    expect(result.outputs).toEqual({
      event,
      events,
      eventCount: 2,
    });
  });

  it("preserves the legacy one-event shape when no batch array is supplied", async () => {
    const result = await node().execute({
      saviaCollectionEvent: event,
    } as NodeContext);

    expect(result.outputs).toEqual({ event, events: [event], eventCount: 1 });
  });
});
