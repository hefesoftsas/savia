import type { ExtensionActionContext } from "@savia/studio-shared/extension-runtime";

export type ConnectorConnectionReader = {
  revealForExecution(
    context: Pick<
      ExtensionActionContext,
      "tenantId" | "extensionId" | "connectionId"
    >,
  ): Promise<Record<string, unknown>>;
};

export type ConnectorActionAdapter = {
  extensionId: string;
  actionId: string;
  requiresConnection?(input: Record<string, unknown>): boolean;
  execute(input: {
    context: ExtensionActionContext;
    connection: Record<string, unknown>;
    input: Record<string, unknown>;
  }): Promise<unknown>;
};

export class ConnectorGatewayError extends Error {
  constructor(
    readonly code:
      | "CONNECTOR_ACTION_NOT_FOUND"
      | "CONNECTOR_CONNECTION_NOT_CONFIGURED"
      | "CONNECTOR_EXTENSION_DISABLED"
      | "CONNECTOR_EXECUTION_FAILED",
  ) {
    super(code);
  }
}

function publicConnectionError(error: unknown): ConnectorGatewayError {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : undefined;
  if (code === "EXTENSION_DISABLED")
    return new ConnectorGatewayError("CONNECTOR_EXTENSION_DISABLED");
  if (code === "EXTENSION_CONNECTION_NOT_CONFIGURED")
    return new ConnectorGatewayError("CONNECTOR_CONNECTION_NOT_CONFIGURED");
  return new ConnectorGatewayError("CONNECTOR_EXECUTION_FAILED");
}

export class ConnectorRegistry {
  private readonly adapters: ReadonlyMap<string, ConnectorActionAdapter>;

  constructor(
    private readonly connections: ConnectorConnectionReader,
    adapters: readonly ConnectorActionAdapter[] = [],
  ) {
    const entries = new Map<string, ConnectorActionAdapter>();
    for (const adapter of adapters) {
      const key = `${adapter.extensionId}/${adapter.actionId}`;
      if (entries.has(key))
        throw new Error(`Duplicate connector action: ${key}`);
      entries.set(key, adapter);
    }
    this.adapters = entries;
  }

  async execute(
    context: ExtensionActionContext,
    input: Record<string, unknown>,
  ): Promise<{ status: "succeeded"; output: unknown }> {
    const adapter = this.adapters.get(
      `${context.extensionId}/${context.actionId}`,
    );
    if (!adapter) throw new ConnectorGatewayError("CONNECTOR_ACTION_NOT_FOUND");
    let connection: Record<string, unknown> = {};
    if (adapter.requiresConnection?.(input) ?? true) {
      try {
        connection = await this.connections.revealForExecution(context);
      } catch (error) {
        throw publicConnectionError(error);
      }
    }
    try {
      return {
        status: "succeeded",
        output: await adapter.execute({ context, connection, input }),
      };
    } catch {
      throw new ConnectorGatewayError("CONNECTOR_EXECUTION_FAILED");
    }
  }
}
