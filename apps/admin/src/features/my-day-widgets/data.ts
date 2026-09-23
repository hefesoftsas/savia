import type { ApiClient } from "@/api/api-client";
import type { MyDayWidget } from "@savia/studio-shared/my-day-widgets";
import type {
  WidgetCollection,
  WidgetCollectionSchema,
  WidgetDomain,
  WidgetRecord,
  WidgetRecordsPage,
  WidgetSummaryGroup,
} from "./types";

export type ObjectsResponse = {
  data: Array<{
    name?: unknown;
    label?: unknown;
    count?: unknown;
    hidden?: unknown;
    config?: {
      fields?: Record<string, { type?: unknown; label?: unknown }>;
      studio?: { screen?: { hidden?: unknown }; requestPage?: unknown };
    };
  }>;
};

type DomainsResponse = {
  data: WidgetDomain[];
};

type RecordsResponse = {
  data: WidgetRecord[];
  total?: number;
};

type SummaryResponse = {
  data: Array<{ value?: unknown; count?: unknown; amount?: unknown }>;
};

function isVisibleObject(row: ObjectsResponse["data"][number]): boolean {
  if (typeof row.name !== "string" || !row.name) return false;
  if (row.hidden === true) return false;
  if (row.config?.studio?.screen?.hidden === true) return false;
  if (row.config?.studio?.requestPage) return false;
  return true;
}

function objectLabel(row: ObjectsResponse["data"][number]): string {
  return typeof row.label === "string" && row.label
    ? row.label
    : String(row.name);
}

export function normalizeCollections(
  apiBasePath: string,
  response: ObjectsResponse,
): WidgetCollection[] {
  return response.data
    .filter(isVisibleObject)
    .map((row) => ({
      apiBasePath,
      name: String(row.name),
      label: objectLabel(row),
      ...(typeof row.count === "number" ? { count: row.count } : {}),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
}

export function normalizeSchema(
  apiBasePath: string,
  response: ObjectsResponse,
  collection: string,
): WidgetCollectionSchema | undefined {
  const row = response.data.find((candidate) => candidate.name === collection);
  if (!row || !isVisibleObject(row)) return undefined;
  const fields = Object.entries(row.config?.fields ?? {})
    .filter(
      (entry): entry is [string, { type?: unknown; label?: unknown }] =>
        typeof entry[1]?.type === "string",
    )
    .map(([name, field]) => ({
      name,
      label:
        typeof field.label === "string" && field.label ? field.label : name,
      type: String(field.type),
    }));
  return { apiBasePath, name: collection, label: objectLabel(row), fields };
}

function recordsPath(widget: MyDayWidget): string {
  if (!("apiBasePath" in widget) || !("collection" in widget)) {
    throw new Error("System widgets have no records endpoint");
  }
  return `${widget.apiBasePath}/api/records/${encodeURIComponent(widget.collection)}`;
}

export async function listWidgetDomains(
  apiClient: ApiClient,
): Promise<WidgetDomain[]> {
  return (await apiClient.get<DomainsResponse>("/v1/data-domains")).data;
}

export async function listWidgetCollections(
  apiClient: ApiClient,
  apiBasePath: string,
): Promise<WidgetCollection[]> {
  const response = await apiClient.get<ObjectsResponse>(
    `${apiBasePath}/api/objects`,
  );
  return normalizeCollections(apiBasePath, response);
}

export async function describeWidgetCollection(
  apiClient: ApiClient,
  apiBasePath: string,
  collection: string,
): Promise<WidgetCollectionSchema | undefined> {
  const response = await apiClient.get<ObjectsResponse>(
    `${apiBasePath}/api/objects`,
  );
  return normalizeSchema(apiBasePath, response, collection);
}

export async function listWidgetRecords(
  apiClient: ApiClient,
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>,
  options?: { signal?: AbortSignal },
): Promise<WidgetRecordsPage> {
  const limit = widget.config?.limit ?? 5;
  const parameters = new URLSearchParams({
    page: "1",
    perPage: String(limit),
    sort: widget.config?.sort ?? "updated_at",
    order: widget.config?.order ?? "DESC",
  });
  const response = await apiClient.get<RecordsResponse>(
    `${recordsPath(widget)}?${parameters}`,
    { signal: options?.signal },
  );
  return {
    data: Array.isArray(response.data) ? response.data : [],
    total: typeof response.total === "number" ? response.total : 0,
  };
}
export async function summarizeWidgetRecords(
  apiClient: ApiClient,
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>,
  groupField: string,
  options?: { signal?: AbortSignal },
): Promise<WidgetSummaryGroup[]> {
  const parameters = new URLSearchParams({ group: groupField });
  if (widget.config?.amountField)
    parameters.set("amountField", widget.config.amountField);
  const response = await apiClient.get<SummaryResponse>(
    `${recordsPath(widget)}/summary?${parameters}`,
    { signal: options?.signal },
  );
  return (Array.isArray(response.data) ? response.data : []).map((row) => ({
    value:
      row.value === null || row.value === undefined ? "—" : String(row.value),
    count: typeof row.count === "number" ? row.count : 0,
    amount: typeof row.amount === "number" ? row.amount : 0,
  }));
}

export function widgetDeepLink(widget: MyDayWidget): string {
  if (!("apiBasePath" in widget) || !("collection" in widget)) return "/my-day";
  const search = new URLSearchParams();
  const domainMatch = widget.apiBasePath.match(/^\/v1\/data-domains\/(.+)$/);
  const agencyMatch = widget.apiBasePath.match(/^\/v1\/dynamic-crm\/(\d+)$/);
  if (domainMatch) search.set("domain", domainMatch[1]);
  else if (agencyMatch) search.set("agencyId", agencyMatch[1]);
  search.set("object", widget.collection);
  // Fase 1: canónica #/studio; #/crm sigue como alias legacy.
  return `/studio?${search.toString()}`;
}

/**
 * Fetches a review window for action widgets: oldest first by the date
 * field so overdue items surface without paging through everything.
 */
export async function listWidgetRecordsForReview(
  apiClient: ApiClient,
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>,
  dateField: string,
  options?: { signal?: AbortSignal },
): Promise<WidgetRecordsPage> {
  const parameters = new URLSearchParams({
    page: "1",
    perPage: "50",
    sort: dateField,
    order: "ASC",
  });
  const response = await apiClient.get<{
    data: WidgetRecord[];
    total?: number;
  }>(`${recordsPath(widget)}?${parameters}`, { signal: options?.signal });
  return {
    data: Array.isArray(response.data) ? response.data : [],
    total: typeof response.total === "number" ? response.total : 0,
  };
}
