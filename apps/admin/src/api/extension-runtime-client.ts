import { apiFetch } from "../features/studio-engine/api";

export type ExtensionConnectionSummary = {
  connectionId: string;
  connectorId: string;
  configured: true;
  updatedAt: string;
};

export type ExtensionRuntimeRequest = (
  path: string,
  init?: RequestInit,
) => Promise<unknown>;

type ExtensionActionResponse = { output: unknown };

function activeDomainRequest(path: string, init?: RequestInit) {
  return apiFetch(`/api${path}`, init);
}

function objectData<T>(value: unknown): T {
  if (value && typeof value === "object" && "data" in value)
    return (value as { data: T }).data;
  return value as T;
}

export class ExtensionRuntimeClient {
  constructor(
    private readonly request: ExtensionRuntimeRequest = activeDomainRequest,
  ) {}

  async listConnections(
    extensionId: string,
  ): Promise<ExtensionConnectionSummary[]> {
    return objectData(
      await this.request(
        `/extensions/${encodeURIComponent(extensionId)}/connections`,
      ),
    );
  }

  async replaceConnection(
    extensionId: string,
    connectionId: string,
    values: { connectorId: string; values: Record<string, unknown> },
  ): Promise<void> {
    await this.request(
      `/extensions/${encodeURIComponent(extensionId)}/connections/${encodeURIComponent(connectionId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );
  }

  async removeConnection(
    extensionId: string,
    connectionId: string,
  ): Promise<void> {
    await this.request(
      `/extensions/${encodeURIComponent(extensionId)}/connections/${encodeURIComponent(connectionId)}`,
      { method: "DELETE" },
    );
  }

  async execute(
    extensionId: string,
    actionId: string,
    input: { connectionId: string; input: Record<string, unknown> },
  ): Promise<ExtensionActionResponse> {
    return objectData(
      await this.request(
        `/extensions/${encodeURIComponent(extensionId)}/actions/${encodeURIComponent(actionId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      ),
    );
  }
}
