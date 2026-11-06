import type { ApiClient } from "@/api/api-client";
import type {
  ApiKeyScope,
  PersonalKey,
} from "@/features/account/personal-api-keys-client";

export type TenantApiKey = PersonalKey & {
  principalId: string;
  ownerName: string;
  ownerEmail: string;
};

export type TenantApiKeyMember = {
  id: string;
  displayName: string;
  email: string;
};

export class TenantApiKeysClient {
  constructor(private api: ApiClient) {}

  private path(tenantId: number) {
    return `/v1/tenants/${encodeURIComponent(tenantId)}/api-keys`;
  }

  list(tenantId: number) {
    return this.api.get<{ keys: TenantApiKey[] }>(this.path(tenantId));
  }

  members(tenantId: number) {
    return this.api.get<{ members: TenantApiKeyMember[] }>(
      `${this.path(tenantId)}/members`,
    );
  }

  create(
    tenantId: number,
    input: {
      principalId: string;
      name: string;
      scopes: ApiKeyScope[];
      lifetimeDays: number;
    },
  ) {
    return this.api.post<{ key: PersonalKey; secret: string }>(
      this.path(tenantId),
      input,
    );
  }

  revoke(tenantId: number, id: string) {
    return this.api.delete(`${this.path(tenantId)}/${encodeURIComponent(id)}`);
  }

  delete(tenantId: number, id: string) {
    return this.revoke(tenantId, id);
  }
}
