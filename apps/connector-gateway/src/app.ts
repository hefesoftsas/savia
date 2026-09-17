import { Hono } from "hono";
import { ExtensionConnectionRepository } from "@savia/crm-server/extension-connections";
import {
  ConnectorGatewayError,
  ConnectorRegistry,
  type ConnectorActionAdapter,
} from "./registry";

export type ConnectorAppOptions = {
  database: D1Database;
  encryptionKey?: string;
  actions?: readonly ConnectorActionAdapter[];
  registry?: Pick<ConnectorRegistry, "execute">;
};

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CONNECTOR_REQUEST_INVALID");
  }
  return value as Record<string, unknown>;
}

function executionRequest(value: unknown) {
  const body = objectBody(value);
  const allowed = new Set([
    "tenantId",
    "principalId",
    "extensionId",
    "actionId",
    "connectionId",
    "runId",
    "input",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key)))
    throw new Error("CONNECTOR_REQUEST_INVALID");
  const required = [
    "tenantId",
    "principalId",
    "extensionId",
    "actionId",
    "connectionId",
    "runId",
  ] as const;
  for (const key of required)
    if (typeof body[key] !== "string" || !body[key].trim())
      throw new Error("CONNECTOR_REQUEST_INVALID");
  return {
    context: {
      tenantId: body.tenantId as string,
      principalId: body.principalId as string,
      extensionId: body.extensionId as string,
      actionId: body.actionId as string,
      connectionId: body.connectionId as string,
      runId: body.runId as string,
    },
    input: objectBody(body.input),
  };
}

function errorStatus(error: unknown): 400 | 403 | 404 | 502 {
  if (error instanceof ConnectorGatewayError) {
    if (error.code === "CONNECTOR_ACTION_NOT_FOUND") return 404;
    if (error.code === "CONNECTOR_CONNECTION_NOT_CONFIGURED") return 404;
    if (error.code === "CONNECTOR_EXTENSION_DISABLED") return 403;
    return 502;
  }
  return 400;
}

function errorCode(error: unknown): string {
  if (error instanceof ConnectorGatewayError) return error.code;
  return "CONNECTOR_REQUEST_INVALID";
}

export function createConnectorApp(options: ConnectorAppOptions) {
  const connections = new ExtensionConnectionRepository(options.database, {
    encryptionKey: options.encryptionKey,
    isExtensionActive: async (tenantId, extensionId) =>
      Boolean(
        await options.database
          .prepare(
            "SELECT 1 FROM crm_extension_installations WHERE tenant_id=? AND id=? AND enabled=1",
          )
          .bind(tenantId, extensionId)
          .first(),
      ),
  });
  const registry =
    options.registry ?? new ConnectorRegistry(connections, options.actions);
  const app = new Hono();

  app.onError((error, context) =>
    context.json({ error: { code: errorCode(error) } }, errorStatus(error)),
  );

  app.post("/internal/execute", async (context) => {
    const request = executionRequest(await context.req.json());
    return context.json(await registry.execute(request.context, request.input));
  });

  return app;
}
