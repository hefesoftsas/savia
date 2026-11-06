import type { ApiClient } from "./api-client";
import type { PublicDocument } from "./domain-types";

export class SaviaCommands {
  constructor(private readonly client: ApiClient) {}

  execute(
    domain: string,
    command: string,
    input: Record<string, unknown>,
  ): Promise<PublicDocument> {
    return this.client.post(
      `/v1/${encodeURIComponent(domain)}/commands/${encodeURIComponent(command)}`,
      input,
    );
  }
}
