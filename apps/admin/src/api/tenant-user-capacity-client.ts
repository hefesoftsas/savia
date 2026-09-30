import type { ApiClient } from "./api-client";

export const MAX_ACTIVE_USER_LIMIT = 2_147_483_647;

export type TenantUserCapacity = {
  tenantId: number;
  maxActiveUsers: number | null;
  activeUsers: number;
};

type TenantUserCapacityResponse = { data: TenantUserCapacity };

export class TenantUserCapacityClient {
  constructor(private readonly client: Pick<ApiClient, "get" | "put">) {}

  async get(tenantId: number): Promise<TenantUserCapacity> {
    this.assertTenantId(tenantId);
    const response = await this.client.get<TenantUserCapacityResponse>(
      `/v1/tenants/${tenantId}/user-capacity`,
    );
    return response.data;
  }

  async set(
    tenantId: number,
    maxActiveUsers: number | null,
  ): Promise<TenantUserCapacity> {
    this.assertTenantId(tenantId);
    if (
      maxActiveUsers !== null &&
      (!Number.isSafeInteger(maxActiveUsers) ||
        maxActiveUsers < 0 ||
        maxActiveUsers > MAX_ACTIVE_USER_LIMIT)
    ) {
      throw new Error("Maximum active users must be a non-negative integer.");
    }
    const response = await this.client.put<TenantUserCapacityResponse>(
      `/v1/tenants/${tenantId}/user-capacity`,
      { maxActiveUsers },
    );
    return response.data;
  }

  private assertTenantId(tenantId: number): void {
    if (!Number.isSafeInteger(tenantId) || tenantId < 1)
      throw new Error("A commercial tenant is required.");
  }
}
