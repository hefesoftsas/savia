import type { ApiClient } from "@/api/api-client";
export type RecordingScope =
  | "recordings:read"
  | "recordings:upload"
  | "recordings:process"
  | "recordings:delete";
export type ApiKeyScope =
  RecordingScope | "records:read" | "records:create" | "records:update";
export type PersonalKey = {
  id: string;
  name: string;
  prefix: string;
  tenantId: number;
  scopes: ApiKeyScope[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
export class PersonalApiKeysClient {
  constructor(private api: ApiClient) {}
  list() {
    return this.api.get<{ keys: PersonalKey[] }>("/v1/account/api-keys");
  }
  tenants() {
    return this.api.get<{ tenants: { id: number; name: string }[] }>(
      "/v1/account/api-keys/tenants",
    );
  }
  create(input: {
    name: string;
    tenantId: number;
    scopes: ApiKeyScope[];
    lifetimeDays: number;
  }) {
    return this.api.post<{ key: PersonalKey; secret: string }>(
      "/v1/account/api-keys",
      input,
    );
  }
  revoke(id: string) {
    return this.api.delete(`/v1/account/api-keys/${encodeURIComponent(id)}`);
  }
  delete(id: string) {
    return this.revoke(id);
  }
}
