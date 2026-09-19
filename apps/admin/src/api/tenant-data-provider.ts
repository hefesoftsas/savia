import type { DataProvider } from "ra-core";
import type { ApiClient } from "./api-client";

export type TenantRecord = {
  id: number;
  name: string;
  kind: "commercial" | "platform";
  idSlug: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  agencyId?: number | null;
};

type InitialUser = {
  email: string;
  firstName: string;
  lastName: string;
  role: "tenant_admin";
  temporaryPassword?: string;
};

export function createTenantDataProvider(
  client: ApiClient,
): Pick<
  DataProvider,
  "getList" | "getOne" | "getMany" | "create" | "update" | "delete"
> {
  return {
    async delete(_resource, params) {
      await client.delete(
        `/v1/tenants/${encodeURIComponent(String(params.id))}`,
      );
      return { data: params.previousData as never };
    },
    async create(_resource, params) {
      const { name, idSlug, isActive, initialUser } = params.data as {
        name: string;
        idSlug?: string;
        isActive?: boolean;
        initialUser: Omit<InitialUser, "role">;
      };
      const response = await client.post<{ data: TenantRecord }>(
        "/v1/tenants",
        {
          name,
          ...(idSlug ? { idSlug } : {}),
          isActive,
          initialUser: { ...initialUser, role: "tenant_admin" },
        },
      );
      return { data: response.data as never };
    },
    async update(_resource, params) {
      const { name, idSlug, isActive } = params.data;
      const response = await client.patch<{ data: TenantRecord }>(
        `/v1/tenants/${encodeURIComponent(String(params.id))}`,
        { name, idSlug, isActive },
      );
      return { data: response.data as never };
    },
    async getList(_resource, params) {
      const response = await client.get<{
        data: TenantRecord[];
        meta: { total: number };
      }>("/v1/tenants", { signal: params.signal });
      const records = response.data.filter(
        (record) =>
          (params.filter?.isActive === undefined ||
            record.isActive === params.filter.isActive) &&
          (params.filter?.kind === undefined ||
            record.kind === params.filter.kind),
      );
      const field = (params.sort?.field ?? "name") as keyof TenantRecord;
      records.sort(
        (a, b) =>
          String(a[field] ?? "").localeCompare(String(b[field] ?? ""), "es") *
          (params.sort?.order === "DESC" ? -1 : 1),
      );
      const perPage = params.pagination?.perPage ?? 100;
      const start = ((params.pagination?.page ?? 1) - 1) * perPage;
      return {
        data: records.slice(start, start + perPage) as never[],
        total: records.length,
      };
    },
    async getOne(_resource, params) {
      const response = await client.get<{ data: TenantRecord }>(
        `/v1/tenants/${encodeURIComponent(String(params.id))}`,
        { signal: params.signal },
      );
      return { data: response.data as never };
    },
    async getMany(_resource, params) {
      const records = await Promise.all(
        params.ids.map(
          async (id) =>
            (
              await client.get<{ data: TenantRecord }>(
                `/v1/tenants/${encodeURIComponent(String(id))}`,
              )
            ).data,
        ),
      );
      return { data: records as never[] };
    },
  };
}
