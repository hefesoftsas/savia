import { useEffect, useRef } from "react";
import {
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  useRealtimeTopics,
  type RealtimeChangeEvent,
} from "@/realtime/use-realtime";
import { getStudioRuntime } from "./runtime";

const TOPICS = ["records", "studio", "workflows", "settings", "integrations"];
const BURST_WINDOW_MS = 200;

function sourceScope(runtime: ReturnType<typeof getStudioRuntime>) {
  return runtime.tenantId === undefined
    ? runtime.apiBasePath
    : `tenant:${runtime.tenantId}`;
}

function workflowScope(runtime: ReturnType<typeof getStudioRuntime>) {
  return JSON.stringify([
    runtime.tenantId,
    runtime.apiBasePath,
    runtime.localWorkspace?.scope,
  ]);
}

function recordQueryKeys(
  collection: string,
  id?: string | number,
  runtime: ReturnType<typeof getStudioRuntime> = getStudioRuntime(),
): QueryKey[] {
  const tenant = runtime.tenantId;
  const base = runtime.apiBasePath;
  const keys: QueryKey[] = [
    ["/api/objects"],
    ["objects"],
    [collection],
    ["summary", collection],
    ["views", collection],
    ["relation-options", base, tenant, collection],
    ["relation-selected", base, tenant, collection],
    ["relation-labels", collection],
    ["link-candidates", base, tenant, collection],
    ["record-links", base, tenant, collection],
    ["record-links", "meta", base, tenant, collection],
    ["record-link-form", base, collection],
    ["operational-tasks", collection],
    ["pipeline", collection],
    ["record-detail", collection],
    ["open-record", collection],
    ["record-activity", collection],
    ["record-files", collection],
    ["r2-attachments", collection],
  ];
  if (id !== undefined) {
    const recordId = String(id);
    keys.push(
      ["record-detail", collection, recordId],
      ["open-record", collection, recordId],
      ["record-activity", collection, recordId],
      ["record-files", collection, recordId],
      ["r2-attachments", collection, recordId],
      ["record-links", base, tenant, collection, recordId],
      ["record-links", "meta", base, tenant, collection, recordId],
      ["record-link-form", base, collection, recordId],
    );
  }
  return keys;
}

/** Maps a hint to only the Studio read models it can affect. */
export function studioRealtimeQueryKeys(
  event: Pick<RealtimeChangeEvent, "topic" | "collection" | "id">,
  runtime: ReturnType<typeof getStudioRuntime> = getStudioRuntime(),
): QueryKey[] {
  const { topic, collection, id } = event;
  switch (topic) {
    case "records":
      return collection ? recordQueryKeys(collection, id, runtime) : [];
    case "studio":
      switch (collection) {
        case "objects":
          return [["/api/objects"], ["objects"], ["extension-client-screens"]];
        case "fields":
          return [
            ["/api/objects"],
            ["objects"],
            ["relation-options", runtime.apiBasePath, runtime.tenantId],
            ["relation-selected", runtime.apiBasePath, runtime.tenantId],
            ["relation-labels"],
          ];
        case "relations":
          return [
            ["collection-relations", runtime.apiBasePath, runtime.tenantId],
            ["record-links", runtime.apiBasePath, runtime.tenantId],
            ["record-links", "meta", runtime.apiBasePath, runtime.tenantId],
            ["record-link-form", runtime.apiBasePath],
            ["related-object", runtime.apiBasePath, runtime.tenantId],
          ];
        case "sources":
          return [
            ["collection-sources", sourceScope(runtime)],
            ["collection-bindings", sourceScope(runtime)],
            ["collection-catalog", sourceScope(runtime)],
            ["crm-workspace", runtime.apiBasePath],
            ...["salesforce", "zoho", "pipedrive"].map((provider) => [
              "crm-workspace",
              provider,
              runtime.apiBasePath,
            ]),
            ["business-setup", runtime.apiBasePath],
          ];
        case "views":
          return [["views"]];
        case "document-delivery":
          return [
            ["document-delivery", runtime.apiBasePath, String(id)],
            ["record-activity"],
          ];
        case "audit":
          return [["audit"]];
        default:
          return [];
      }
    case "workflows":
      switch (collection) {
        case "definitions":
          return [
            ["workflows", workflowScope(runtime)],
            ["workflow-bundles", workflowScope(runtime)],
            ["workflow-webhook", workflowScope(runtime)],
            ["workflow-webhook-destinations", workflowScope(runtime)],
          ];
        case "executions":
          return [
            ["workflow-history", workflowScope(runtime)],
            ["workflow-execution", workflowScope(runtime)],
            ["workflow-inbox", workflowScope(runtime)],
            ["automation-runs", workflowScope(runtime)],
          ];
        case "inbox":
          return [["workflow-inbox", workflowScope(runtime)]];
        default:
          return [];
      }
    case "settings":
      switch (collection) {
        case "credentials":
          return [["integrations"]];
        case "configuration":
          return [["geocoding-settings"]];
        default:
          return [];
      }
    case "integrations":
      switch (collection) {
        case "integrations":
          return [["integrations"], ["integration-target-objects"]];
        case "runs":
          return [["integration-runs"]];
        default:
          return [];
      }
    default:
      return [];
  }
}

export async function invalidateStudioRealtimeEvent(
  client: QueryClient,
  event: Pick<RealtimeChangeEvent, "topic" | "collection" | "id">,
  runtime: ReturnType<typeof getStudioRuntime> = getStudioRuntime(),
): Promise<void> {
  await Promise.all(
    studioRealtimeQueryKeys(event, runtime).map((queryKey) =>
      client.invalidateQueries({ queryKey, refetchType: "active" }),
    ),
  );
}

function reconnectQueryKeys(
  runtime: ReturnType<typeof getStudioRuntime>,
  client: ReturnType<typeof useQueryClient>,
): QueryKey[] {
  const objects = client.getQueryData<{ data?: Array<{ name?: unknown }> }>([
    "/api/objects",
  ]);
  const recordCollections = (objects?.data ?? [])
    .map((object) => object.name)
    .filter((name): name is string => typeof name === "string" && !!name);
  const all: QueryKey[] = [
    ["/api/objects"],
    ["objects"],
    ["extension-client-screens"],
    ["collection-relations", runtime.apiBasePath, runtime.tenantId],
    ["record-links", runtime.apiBasePath, runtime.tenantId],
    ["record-links", "meta", runtime.apiBasePath, runtime.tenantId],
    ["record-link-form", runtime.apiBasePath],
    ["related-object", runtime.apiBasePath, runtime.tenantId],
    ["collection-sources", sourceScope(runtime)],
    ["collection-bindings", sourceScope(runtime)],
    ["collection-catalog", sourceScope(runtime)],
    ["crm-workspace", runtime.apiBasePath],
    ...["salesforce", "zoho", "pipedrive"].map((provider) => [
      "crm-workspace",
      provider,
      runtime.apiBasePath,
    ]),
    ["business-setup", runtime.apiBasePath],
    ["audit"],
    ["views"],
    ["workflows", workflowScope(runtime)],
    ["workflow-bundles", workflowScope(runtime)],
    ["workflow-history", workflowScope(runtime)],
    ["workflow-execution", workflowScope(runtime)],
    ["workflow-inbox", workflowScope(runtime)],
    ["workflow-webhook", workflowScope(runtime)],
    ["automation-runs", workflowScope(runtime)],
    ["integrations"],
    ["integration-runs"],
    ["integration-target-objects"],
    ["geocoding-settings"],
  ];
  if (!runtime.localWorkspace)
    for (const collection of recordCollections)
      all.push(...recordQueryKeys(collection, undefined, runtime));
  return all;
}

/** One tenant-scoped socket fans hints into the active Studio read models. */
export function StudioRealtimeBridge() {
  const client = useQueryClient();
  const runtime = getStudioRuntime();
  const tenantId = runtime.tenantId;
  const pending = useRef(new Map<string, QueryKey>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const keys = [...pending.current.values()];
      pending.current.clear();
      for (const queryKey of keys)
        void client.invalidateQueries({ queryKey, refetchType: "active" });
    }, BURST_WINDOW_MS);
  };
  const enqueue = (keys: QueryKey[]) => {
    for (const key of keys) pending.current.set(JSON.stringify(key), key);
    if (keys.length) flush();
  };

  useRealtimeTopics({
    topics: TOPICS,
    tenantId,
    enabled: tenantId !== undefined,
    onConnected: (reason) => {
      if (reason === "subscription-change") return;
      if (runtime.localWorkspace) runtime.localWorkspace.requestSync();
      enqueue(reconnectQueryKeys(runtime, client));
    },
    onEvent: (event) => {
      if (event.topic === "records" && runtime.localWorkspace)
        runtime.localWorkspace.requestSync();
      enqueue(studioRealtimeQueryKeys(event, runtime));
    },
  });

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      pending.current.clear();
    },
    [tenantId],
  );
  return null;
}
