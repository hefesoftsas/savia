import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";
import {
  invalidateStudioRealtimeEvent,
  studioRealtimeQueryKeys,
} from "../studio-realtime";
import { getStudioRuntime, setStudioRuntime } from "../runtime";

afterEach(() => {
  setStudioRuntime({ embedded: false });
});

it("routes record hints to that collection and its open record read models", () => {
  setStudioRuntime({ embedded: true, tenantId: 3, apiBasePath: "/t/3" });
  const keys = studioRealtimeQueryKeys(
    { topic: "records", collection: "requests", id: "42" },
    { ...getStudioRuntime() },
  );
  expect(keys).toContainEqual(["requests"]);
  expect(keys).toContainEqual(["summary", "requests"]);
  expect(keys).toContainEqual(["record-detail", "requests", "42"]);
  expect(keys).toContainEqual(["record-detail", "requests"]);
  expect(keys).toContainEqual(["record-activity", "requests", "42"]);
  expect(keys).toContainEqual(["record-files", "requests", "42"]);
  expect(keys).toContainEqual(["r2-attachments", "requests"]);
  expect(keys).toContainEqual(["/api/objects"]);
  expect(keys).toContainEqual(["record-links", "/t/3", 3, "requests", "42"]);
  expect(
    studioRealtimeQueryKeys({ topic: "records", collection: "requests" }),
  ).toContainEqual(["views", "requests"]);
});

it("invalidates only the affected Studio record detail and keeps other collections fresh", async () => {
  setStudioRuntime({ embedded: true, tenantId: 3, apiBasePath: "/t/3" });
  const client = new QueryClient();
  client.setQueryData(["record-detail", "requests", "42", 1], "request");
  client.setQueryData(["record-detail", "accounts", "42", 1], "account");
  await invalidateStudioRealtimeEvent(
    client,
    { topic: "records", collection: "requests", id: "42" },
    { ...getStudioRuntime() },
  );
  expect(
    client.getQueryState(["record-detail", "requests", "42", 1])?.isInvalidated,
  ).toBe(true);
  expect(
    client.getQueryState(["record-detail", "accounts", "42", 1])?.isInvalidated,
  ).toBe(false);
  client.clear();
});

it("maps only the named metadata and workflow read models", () => {
  setStudioRuntime({ embedded: true, tenantId: 3, apiBasePath: "/t/3" });
  const relations = studioRealtimeQueryKeys({
    topic: "studio",
    collection: "relations",
  });
  expect(relations).toContainEqual(["collection-relations", "/t/3", 3]);
  const sources = studioRealtimeQueryKeys({
    topic: "studio",
    collection: "sources",
  });
  expect(sources).toContainEqual(["collection-sources", "tenant:3"]);
  expect(
    studioRealtimeQueryKeys({ topic: "studio", collection: "unknown" }),
  ).toEqual([]);
  expect(
    studioRealtimeQueryKeys({
      topic: "workflows",
      collection: "executions",
    }).map((key) => key[0]),
  ).toContain("workflow-history");
  expect(
    studioRealtimeQueryKeys({
      topic: "workflows",
      collection: "definitions",
    }).map((key) => key[0]),
  ).toEqual([
    "workflows",
    "workflow-bundles",
    "workflow-webhook",
    "workflow-webhook-destinations",
  ]);
});

it("refreshes delivery history only in the active workspace", () => {
  const keys = studioRealtimeQueryKeys(
    { topic: "studio", collection: "document-delivery", id: "file-42" },
    { embedded: true, tenantId: 3, apiBasePath: "/v1/studio/3" },
  );
  expect(keys).toContainEqual(["document-delivery", "/v1/studio/3", "file-42"]);
  expect(keys).toContainEqual(["record-activity"]);
});
