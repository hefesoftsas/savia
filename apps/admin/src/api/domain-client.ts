import type { ApiClient } from "./api-client";
import type { DomainDescriptor } from "./domain-types";

export class DomainClient {
  constructor(private readonly client: ApiClient) {}

  async list(): Promise<DomainDescriptor[]> {
    return (await this.client.get<{ data: DomainDescriptor[] }>("/v1/domains"))
      .data;
  }
}
