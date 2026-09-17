import { z } from "zod";
import {
  extensionConnectionIdSchema,
  extensionActionContextSchema,
  type ExtensionActionExecutor,
  type ExtensionConnectorDefinition,
} from "@savia/crm-shared/extension-runtime";
import {
  createExtensionRegistry,
  type ExtensionRegistry,
} from "@savia/crm-shared/extension-package";
import type { Context, Hono } from "hono";
import type { Env } from "./context";
import { fail } from "./context";
import { ExtensionRuntimeError } from "./extension-connections";
import { isExtensionAvailable, type ExtensionOptions } from "./extensions";

const emptyRegistry = createExtensionRegistry([]);

function connectorFor(
  registry: ExtensionRegistry,
  extensionId: string,
  connectorId: string,
): ExtensionConnectorDefinition {
  const connector = registry
    .get(extensionId)
    ?.runtime?.connectors?.find((item) => item.connectorId === connectorId);
  if (!connector) fail("El conector no pertenece a la extensión.", 422);
  return connector;
}

function actionFor(
  registry: ExtensionRegistry,
  extensionId: string,
  actionId: string,
) {
  const action = registry
    .get(extensionId)
    ?.runtime?.actions?.find((item) => item.actionId === actionId);
  if (!action) fail("La acción no pertenece a la extensión.", 404);
  return action;
}

function settingsFor(registry: ExtensionRegistry, extensionId: string) {
  const settings = registry.get(extensionId)?.runtime?.settings;
  if (!settings) fail("La extensión no declara configuración.", 404);
  return settings;
}

async function assertAvailable(
  db: D1Database,
  tenantId: string,
  extensionId: string,
  registry: ExtensionRegistry,
): Promise<void> {
  if (!(await isExtensionAvailable(db, tenantId, extensionId, registry)))
    fail("La extensión no está disponible en este tenant.", 404);
}

export function registerExtensionActions(
  app: Hono<Env>,
  options: ExtensionOptions = {},
) {
  const registry = options.extensionRegistry ?? emptyRegistry;
  const connections = options.connectionRepository;
  const settings = options.settingsRepository;
  if (!connections && !settings) return;
  const assertManager = async (c: Context<Env>) => {
    const extensionId = c.req.param("extensionId");
    if (!extensionId)
      fail("La extensión no está disponible en este tenant.", 404);
    if (
      options.canManageExtension &&
      !(await options.canManageExtension({
        tenantId: c.get("tenant"),
        principalId: c.get("principalId"),
        extensionId,
      }))
    )
      fail("No tienes permiso para administrar esta extensión.", 403);
  };

  if (settings) {
    app.get("/api/extensions/:extensionId/settings", async (c) => {
      const tenantId = c.get("tenant");
      const extensionId = c.req.param("extensionId");
      await assertAvailable(c.env.DB, tenantId, extensionId, registry);
      await assertManager(c);
      return c.json({
        data: await settings.get(
          { tenantId, extensionId },
          settingsFor(registry, extensionId),
        ),
      });
    });

    app.put("/api/extensions/:extensionId/settings", async (c) => {
      const tenantId = c.get("tenant");
      const extensionId = c.req.param("extensionId");
      await assertAvailable(c.env.DB, tenantId, extensionId, registry);
      await assertManager(c);
      const input = z
        .object({
          value: z.record(z.string(), z.unknown()),
          version: z.number().int().min(0),
        })
        .strict()
        .parse(await c.req.json());
      try {
        return c.json({
          data: await settings.replace(
            {
              tenantId,
              extensionId,
              principalId: c.get("principalId"),
              version: input.version,
            },
            settingsFor(registry, extensionId),
            input.value,
          ),
        });
      } catch (error) {
        if (
          error instanceof ExtensionRuntimeError &&
          error.code === "EXTENSION_SETTINGS_VERSION_CONFLICT"
        )
          fail("La configuración cambió. Recarga e intenta otra vez.", 409);
        if (
          error instanceof ExtensionRuntimeError &&
          error.code === "EXTENSION_SETTINGS_INVALID"
        )
          fail("La configuración de la extensión no es válida.", 422);
        throw error;
      }
    });
  }

  if (!connections) return;

  app.get("/api/extensions/:extensionId/connections", async (c) => {
    const tenantId = c.get("tenant");
    const extensionId = c.req.param("extensionId");
    await assertAvailable(c.env.DB, tenantId, extensionId, registry);
    await assertManager(c);
    return c.json({ data: await connections.list(tenantId, extensionId) });
  });

  app.put(
    "/api/extensions/:extensionId/connections/:connectionId",
    async (c) => {
      const tenantId = c.get("tenant");
      const extensionId = c.req.param("extensionId");
      const connectionId = extensionConnectionIdSchema.parse(
        c.req.param("connectionId"),
      );
      await assertAvailable(c.env.DB, tenantId, extensionId, registry);
      await assertManager(c);
      const input = z
        .object({
          connectorId: z.string(),
          values: z.record(z.string(), z.unknown()),
        })
        .strict()
        .parse(await c.req.json());
      const connector = connectorFor(registry, extensionId, input.connectorId);
      const values = connector.configurationSchema.parse(input.values);
      await connections.replace(
        {
          tenantId,
          extensionId,
          connectionId,
          connectorId: connector.connectorId,
          principalId: c.get("principalId"),
        },
        values,
      );
      return c.body(null, 204);
    },
  );

  app.delete(
    "/api/extensions/:extensionId/connections/:connectionId",
    async (c) => {
      const tenantId = c.get("tenant");
      const extensionId = c.req.param("extensionId");
      const connectionId = extensionConnectionIdSchema.parse(
        c.req.param("connectionId"),
      );
      await assertAvailable(c.env.DB, tenantId, extensionId, registry);
      await assertManager(c);
      await connections.remove({
        tenantId,
        extensionId,
        connectionId,
        principalId: c.get("principalId"),
      });
      return c.body(null, 204);
    },
  );

  app.get("/api/extensions/:extensionId/actions/runs", async (c) => {
    const tenantId = c.get("tenant");
    const extensionId = c.req.param("extensionId");
    await assertAvailable(c.env.DB, tenantId, extensionId, registry);
    const parsedLimit = Number(c.req.query("limit") ?? 20);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(100, Math.max(1, Math.floor(parsedLimit)))
      : 20;
    return c.json({
      data: await connections.listRuns({
        tenantId,
        extensionId,
        principalId: c.get("principalId"),
        limit,
      }),
    });
  });

  app.post("/api/extensions/:extensionId/actions/:actionId", async (c) => {
    const tenantId = c.get("tenant");
    const extensionId = c.req.param("extensionId");
    const actionId = c.req.param("actionId");
    await assertAvailable(c.env.DB, tenantId, extensionId, registry);
    const action = actionFor(registry, extensionId, actionId);
    const input = z
      .object({
        connectionId: extensionConnectionIdSchema.optional(),
        input: z.record(z.string(), z.unknown()),
      })
      .strict()
      .parse(await c.req.json());
    const connectionId = input.connectionId ?? "simulation";
    if (input.connectionId) {
      const connection = await connections.summary({
        tenantId,
        extensionId,
        connectionId: input.connectionId,
      });
      if (!connection) fail("La conexión no está configurada.", 422);
      if (connection.connectorId !== action.connectorId)
        fail("La conexión no corresponde a la acción.", 422);
    } else if (!action.connectionOptional) {
      fail("La acción requiere una conexión configurada.", 422);
    }
    const actionInput = action.inputSchema.parse(input.input);
    const context = extensionActionContextSchema.parse({
      tenantId,
      principalId: c.get("principalId"),
      extensionId,
      actionId: action.actionId,
      connectionId,
      runId: crypto.randomUUID(),
    });
    await connections.startRun(context, actionInput);
    const executor: ExtensionActionExecutor | undefined =
      options.actionExecutor;
    if (!executor) {
      await connections.failRun(context, "CONNECTOR_GATEWAY_UNAVAILABLE");
      return c.json(
        { error: "El gateway de conectores no está disponible." },
        502,
      );
    }
    try {
      const result = await executor.execute(context, actionInput);
      if (result.status !== "succeeded") {
        await connections.failRun(
          context,
          "CONNECTOR_EXECUTION_FAILED",
          result.output,
        );
        return c.json(
          { error: "El conector no pudo completar la acción." },
          502,
        );
      }
      const run = await connections.completeRun(context, result.output);
      return c.json({ data: { run, output: result.output } }, 201);
    } catch {
      await connections.failRun(context, "CONNECTOR_EXECUTION_FAILED");
      return c.json({ error: "El conector no pudo completar la acción." }, 502);
    }
  });
}
