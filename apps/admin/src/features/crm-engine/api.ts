import type { DataProvider } from "ra-core";
import { getCrmRuntime } from "./runtime";
export async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await crmFetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (response.status === 204 || response.status === 205) return undefined as T;
  if (!response.ok) {
    const failure = await response.json().catch(() => undefined);
    throw Object.assign(
      new Error(
        typeof failure?.error === "string"
          ? failure.error
          : (failure?.error?.message ?? `Error ${response.status}`),
      ),
      { status: response.status },
    );
  }
  const data: any = await response.json();
  return data as T;
}
export const api = <T = any>(
  url: string,
  method = "GET",
  data?: unknown,
  options?: RequestInit,
) =>
  apiFetch<T>("/api" + url, {
    ...options,
    method,
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
const list = (resource: string, params: any) =>
  api(
    "/records/" +
      resource +
      "?" +
      new URLSearchParams({
        page: String(params.pagination?.page ?? 1),
        perPage: String(params.pagination?.perPage ?? 25),
        ...(params.filter?.__collectionSort === false
          ? {}
          : {
              sort: params.sort?.field ?? "updated_at",
              order: params.sort?.order ?? "DESC",
            }),
        ...(params.filter?.__collectionSearch === false
          ? {}
          : {
              q: params.filter?.q ?? "",
              ...(params.filter?.searchField
                ? { searchField: params.filter.searchField }
                : {}),
            }),
        ...(params.filter?.__collectionFilter !== false && params.filter?.stage
          ? { stage: params.filter.stage }
          : {}),
        ...(params.filter?.__collectionFilter !== false &&
        params.filter?.filters
          ? { filters: params.filter.filters }
          : {}),
        ...(params.filter?.trash ? { trash: params.filter.trash } : {}),
      }),
  );
export const dataProvider: DataProvider = {
  getList: list,
  getOne: (resource, params) => api(`/records/${resource}/${params.id}`),
  getMany: async (resource, params) => ({
    data: await Promise.all(
      params.ids.map((id) =>
        api(`/records/${resource}/${id}`).then((r) => r.data),
      ),
    ),
  }),
  getManyReference: (resource, params) => list(resource, params),
  create: (resource, params) =>
    api(`/records/${resource}`, "POST", params.data),
  update: (resource, params) =>
    api(`/records/${resource}/${params.id}`, "PATCH", {
      ...params.data,
      _version: params.previousData?._version ?? params.data._version,
    }),
  delete: (resource, params) =>
    api(
      `/records/${resource}/${params.id}?version=${params.previousData?._version}`,
      "DELETE",
    ),
  updateMany: async (resource, params) => {
    if (!params.meta?.versions)
      throw new Error(
        "La edición masiva requiere las versiones de los registros seleccionados.",
      );
    const result = await api(`/records/${resource}/bulk`, "POST", {
      action: "update",
      records: params.ids.map((id) => ({
        id,
        version: params.meta.versions[id],
      })),
      data: params.data,
    });
    if (result.data.some((row: any) => !row.ok))
      throw new Error(
        result.data
          .filter((row: any) => !row.ok)
          .map((row: any) => row.error)
          .join(" "),
      );
    return { data: params.ids };
  },
  deleteMany: async (resource, params) => {
    if (!params.meta?.versions)
      throw new Error(
        "La eliminación masiva requiere las versiones de los registros seleccionados.",
      );
    const result = await api(`/records/${resource}/bulk`, "POST", {
      action: "delete",
      records: params.ids.map((id) => ({
        id,
        version: params.meta.versions[id],
      })),
    });
    if (result.data.some((row: any) => !row.ok))
      throw new Error(
        result.data
          .filter((row: any) => !row.ok)
          .map((row: any) => row.error)
          .join(" "),
      );
    return { data: params.ids };
  },
};

export function crmFetch(url: string, init?: RequestInit): Promise<Response> {
  const runtime = getCrmRuntime();
  if (runtime.transport) return runtime.transport(url, init);
  if (runtime.embedded)
    return Promise.resolve(
      Response.json({ error: "Abre el CRM desde Savia." }, { status: 401 }),
    );
  return fetch(url, init);
}
export async function downloadCrm(url: string, name: string) {
  const response = await crmFetch(url);
  if (!response.ok)
    throw new Error(
      ((await response.json()) as { error?: string }).error ??
        "No se pudo descargar el archivo.",
    );
  const blob = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = blob;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blob), 1000);
}
