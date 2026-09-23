import { z } from "zod";
import {
  extensionConnectionIdSchema,
  extensionActionContextSchema,
  type ExtensionActionExecutor,
  type ExtensionConnectorDefinition,
  type ExtensionSettingsDefinition,
} from "@savia/studio-shared/extension-runtime";
import {
  renderSimulationOutput,
  type StoreAction,
} from "@savia/studio-shared/plugin-store";
import {
  createExtensionRegistry,
  type ExtensionRegistry,
} from "@savia/studio-shared/extension-package";
import type { Context, Hono } from "hono";
import type { Env } from "./context";
import { fail } from "./context";
import { ExtensionRuntimeError } from "./extension-connections";
import { isExtensionAvailable, type ExtensionOptions } from "./extensions";
import {
  executeStoreHttpAction,
  storeConfigFor,
  storeConnectorDefinition,
  StoreHttpInputError,
} from "./plugin-store";

const emptyRegistry = createExtensionRegistry([]);

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

async function resolveConnector(
  db: D1Database,
  tenantId: string,
  registry: ExtensionRegistry,
  extensionId: string,
  connectorId: string,
): Promise<ExtensionConnectorDefinition | null> {
  return (
    registry
      .get(extensionId)
      ?.runtime?.connectors?.find((item) => item.connectorId === connectorId) ??
    (await storeConnectorDefinition(db, tenantId, extensionId, connectorId))
  );
}

async function storeSettingsFor(
  db: D1Database,
  tenantId: string,
  extensionId: string,
): Promise<ExtensionSettingsDefinition | null> {
  const config = await storeConfigFor(db, tenantId, extensionId);
  if (!config?.settings) return null;
  return {
    extensionId,
    schema: z.record(z.string(), z.unknown()),
    defaults: config.settings.defaults,
  };
}

async function resolveSettings(
  db: D1Database,
  tenantId: string,
  registry: ExtensionRegistry,
  extensionId: string,
): Promise<ExtensionSettingsDefinition> {
  return (
    registry.get(extensionId)?.runtime?.settings ??
    (await storeSettingsFor(db, tenantId, extensionId)) ??
    fail("La extensión no declara configuración.", 404)
  );
}

async function resolveStoreAction(
  db: D1Database,
  tenantId: string,
  extensionId: string,
  actionId: string,
): Promise<StoreAction | null> {
  const config = await storeConfigFor(db, tenantId, extensionId);
  return config?.actions.find((action) => action.id === actionId) ?? null;
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
          await resolveSettings(c.env.DB, tenantId, registry, extensionId),
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
            await resolveSettings(c.env.DB, tenantId, registry, extensionId),
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

  app.post("/api/extensions/:extensionId/actions/:actionId", async (c) => {
    const tenantId = c.get("tenant");
    const extensionId = c.req.param("extensionId");
    const actionId = c.req.param("actionId");
    await assertAvailable(c.env.DB, tenantId, extensionId, registry);
    const input = z
      .object({
        connectionId: extensionConnectionIdSchema.optional(),
        input: z.record(z.string(), z.unknown()),
      })
      .strict()
      .parse(await c.req.json());
    // Acciones del store: simulación declarativa (sin red ni secretos)
    // o delegación a una acción compilada del release.
    const stored = await resolveStoreAction(
      c.env.DB,
      tenantId,
      extensionId,
      actionId,
    );
    if (stored?.kind === "simulation") {
      const context = extensionActionContextSchema.parse({
        tenantId,
        principalId: c.get("principalId"),
        extensionId,
        actionId: stored.id,
        connectionId: "simulation",
        runId: crypto.randomUUID(),
      });
      const output = renderSimulationOutput(stored.output, input.input);
      if (connections) {
        await connections.startRun(context, input.input);
        const run = await connections.completeRun(context, output);
        return c.json({ data: { run, output } }, 201);
      }
      return c.json(
        {
          data: {
            run: { runId: context.runId, status: "succeeded" },
            output,
          },
        },
        201,
      );
    }
    // Acciones http del store: el host revela los secretos del tenant,
    // interpola la petición, la ejecuta con allowlist anti-SSRF y
    // devuelve la respuesta redactada.
    if (stored?.kind === "http") {
      if (!connections)
        return c.json(
          { error: "El gateway de conectores no está disponible." },
          502,
        );
      const config = await storeConfigFor(c.env.DB, tenantId, extensionId);
      const connector = config?.connectors.find(
        (item) => item.id === stored.connector,
      );
      if (!connector)
        return fail("El conector no pertenece a la extensión.", 422);
      const connectionId = input.connectionId ?? null;
      if (!connectionId && !stored.connectionOptional)
        return fail("Configura la conexión del conector.", 422);
      let values: Record<string, unknown> = {};
      if (connectionId) {
        const summary = await connections.summary({
          tenantId,
          extensionId,
          connectionId,
        });
        if (!summary || summary.connectorId !== connector.id)
          return fail("La conexión no está configurada.", 422);
        try {
          values = await connections.revealForExecution({
            tenantId,
            extensionId,
            connectionId,
          });
        } catch (error) {
          if (error instanceof ExtensionRuntimeError)
            return fail("La conexión no está configurada.", 422);
          throw error;
        }
      }
      const context = extensionActionContextSchema.parse({
        tenantId,
        principalId: c.get("principalId"),
        extensionId,
        actionId: stored.id,
        connectionId: connectionId ?? "direct",
        runId: crypto.randomUUID(),
      });
      await connections.startRun(context, input.input);
      try {
        const output = await executeStoreHttpAction({
          action: stored,
          connector,
          values,
          actionInput: input.input,
        });
        const run = await connections.completeRun(context, output);
        return c.json({ data: { run, output } }, 201);
      } catch (error) {
        await connections.failRun(context, "CONNECTOR_EXECUTION_FAILED");
        if (error instanceof StoreHttpInputError)
          return c.json({ error: error.message }, 422);
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "El proveedor no respondió.",
          },
          502,
        );
      }
    }
    // Delegación a una acción compilada del release (p. ej. savia-request
    // vía insurance.quotes): el contexto se reescribe al destino y los
    // secretos/servicios siguen del lado del release.
    let resolvedExtensionId = extensionId;
    if (stored?.kind === "delegate") {
      if (!registry.get(stored.extension))
        return fail(
          "La extensión destino no está incluida en el release.",
          404,
        );
      if (
        !(await isExtensionAvailable(
          c.env.DB,
          tenantId,
          stored.extension,
          registry,
        ))
      )
        return fail(`Activa primero ${stored.extension} en este espacio.`, 409);
      resolvedExtensionId = stored.extension;
    }
    if (!connections)
      return c.json(
        { error: "El gateway de conectores no está disponible." },
        502,
      );
    const action = actionFor(
      registry,
      resolvedExtensionId,
      stored?.kind === "delegate" ? stored.action : actionId,
    );
    const connectionId = input.connectionId ?? "simulation";
    if (input.connectionId) {
      const connection = await connections.summary({
        tenantId,
        extensionId: resolvedExtensionId,
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
      extensionId: resolvedExtensionId,
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
      const connector = await resolveConnector(
        c.env.DB,
        tenantId,
        registry,
        extensionId,
        input.connectorId,
      );
      if (!connector)
        return fail("El conector no pertenece a la extensión.", 422);
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
}
