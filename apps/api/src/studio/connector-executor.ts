import type {
  ExtensionActionContext,
  ExtensionActionExecutor,
} from "@savia/studio-shared/extension-runtime";

export type ExtensionConnectionSecrets = {
  EXTENSION_CONNECTIONS_ENCRYPTION_KEY?: string;
};

export type ConnectorGatewayEnvironment = ExtensionConnectionSecrets & {
  CONNECTOR_GATEWAY?: { fetch(request: Request): Promise<Response> };
};

const publicCodes = new Set([
  "CONNECTOR_ACTION_NOT_FOUND",
  "CONNECTOR_CONNECTION_NOT_CONFIGURED",
  "CONNECTOR_EXTENSION_DISABLED",
  "CONNECTOR_EXECUTION_FAILED",
]);

function failed(code: string) {
  return { status: "failed" as const, output: { code } };
}

function errorCode(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    value.error &&
    typeof value.error === "object" &&
    "code" in value.error &&
    typeof value.error.code === "string" &&
    publicCodes.has(value.error.code)
  )
    return value.error.code;
  return "CONNECTOR_EXECUTION_FAILED";
}

function successfulResult(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "status" in value &&
    value.status === "succeeded" &&
    "output" in value
  )
    return { status: "succeeded" as const, output: value.output };
  return undefined;
}

export function extensionConnectionsEncryptionKeyFromEnvironment(
  environment: ExtensionConnectionSecrets,
): string | undefined {
  return environment.EXTENSION_CONNECTIONS_ENCRYPTION_KEY?.trim() || undefined;
}

export function connectorExecutorFromEnvironment(
  environment: ConnectorGatewayEnvironment,
): ExtensionActionExecutor {
  return {
    async execute(
      context: ExtensionActionContext,
      input: Record<string, unknown>,
    ) {
      if (!environment.CONNECTOR_GATEWAY)
        return failed("CONNECTOR_GATEWAY_UNAVAILABLE");
      try {
        const response = await environment.CONNECTOR_GATEWAY.fetch(
          new Request("https://savia-connectors.internal/internal/execute", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...context, input }),
          }),
        );
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok) return failed(errorCode(body));
        return successfulResult(body) ?? failed("CONNECTOR_EXECUTION_FAILED");
      } catch {
        return failed("CONNECTOR_GATEWAY_UNAVAILABLE");
      }
    },
  };
}
