import {
  databaseConnectionSchema,
  databaseReadSchema,
  databaseMutationSchema,
  databaseResourceName,
  DatabaseBridgeError,
  type DatabaseKind,
} from "@savia/crm-shared/database-sources";
import { databaseError } from "./database-errors";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z, ZodError } from "zod";
import {
  bridgeQuerySchema,
  postgresConnectionSchema,
  sqlIdentifier,
} from "@savia/crm-shared/sql-sources";
import type { BridgeDriver, DatabaseDriver } from "./driver";

export type DbBridgeOptions = {
  driver?: BridgeDriver;
  drivers?: Partial<Record<DatabaseKind, DatabaseDriver>>;
  /** Secreto compartido con la API. Sin secreto, el puente no arranca. */
  sharedSecret?: string;
  /** Hosts Postgres permitidos (coma). "*" lo desactiva (solo desarrollo). */
  allowedHosts?: string;
};

function fail(
  message: string,
  status: 400 | 401 | 403 | 404 | 502 = 502,
): never {
  throw new HTTPException(status, { message });
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1)
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export function createDbBridgeApp(options: DbBridgeOptions) {
  const { driver } = options;
  const secret = options.sharedSecret?.trim();
  const allowedHosts = (options.allowedHosts ?? "*")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  const app = new Hono();

  app.onError((error, context) => {
    if (error instanceof DatabaseBridgeError)
      return context.json(
        {
          error: error.message,
          code: error.code,
          ...(error.outcome ? { outcome: error.outcome } : {}),
        },
        error.status,
      );
    if (error instanceof HTTPException)
      return context.json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return context.json(
        { error: error.issues[0]?.message ?? "Solicitud inválida." },
        422,
      );
    if (error instanceof SyntaxError)
      return context.json({ error: "JSON inválido." }, 422);
    const status = (error as { status?: unknown }).status;
    if (status === 404)
      return context.json({ error: "No encontrado en la base externa." }, 404);
    console.error(
      "[db-bridge]",
      error instanceof Error ? error.message : error,
    );
    return context.json(
      { error: "La base externa rechazó la operación." },
      502,
    );
  });

  app.get("/health", (context) => context.json({ ok: true }));

  app.use(
    "/introspect",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (context) =>
        context.json({ error: "Máximo 64 KB por solicitud." }, 413),
    }),
  );
  app.use(
    "/query",
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (context) =>
        context.json({ error: "Máximo 256 KB por solicitud." }, 413),
    }),
  );

  app.use("/introspect", async (context, next) => {
    if (!secret) return context.json({ error: "Puente sin secreto." }, 503);
    const presented = context.req.header("authorization") ?? "";
    if (!timingSafeEqual(presented, `Bearer ${secret}`))
      return context.json({ error: "No autorizado." }, 401);
    await next();
  });
  app.use("/query", async (context, next) => {
    if (!secret) return context.json({ error: "Puente sin secreto." }, 503);
    const presented = context.req.header("authorization") ?? "";
    if (!timingSafeEqual(presented, `Bearer ${secret}`))
      return context.json({ error: "No autorizado." }, 401);
    await next();
  });

  const assertHostAllowed = (host: string) => {
    if (allowedHosts.includes("*")) return;
    if (!allowedHosts.includes(host.toLowerCase()))
      fail(`Host no permitido por el puente: ${host}.`, 403);
  };

  const connectionSchema = postgresConnectionSchema.extend({
    password: z.string().max(10000),
  });

  app.use(
    "/database/*",
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) => c.json({ error: "Request too large" }, 413),
    }),
  );
  app.use("/database/*", async (c, next) => {
    if (!secret) return c.json({ error: "Bridge is not configured" }, 503);
    if (
      !timingSafeEqual(c.req.header("authorization") ?? "", `Bearer ${secret}`)
    )
      return c.json({ error: "Unauthorized" }, 401);
    await next();
  });
  for (const operation of [
    "test",
    "resources",
    "inspect",
    "read",
    "mutate",
  ] as const) {
    app.post(`/database/${operation}`, async (c) => {
      const raw = await c.req.json();
      const input =
        operation === "read"
          ? databaseReadSchema.parse(raw)
          : operation === "mutate"
            ? databaseMutationSchema.parse(raw)
            : z
                .object({
                  connection: databaseConnectionSchema,
                  ...(operation === "inspect"
                    ? { resource: databaseResourceName }
                    : {}),
                })
                .strict()
                .parse(raw);
      assertHostAllowed(input.connection.host);
      const adapter = options.drivers?.[input.connection.kind];
      if (!adapter)
        throw new DatabaseBridgeError(
          "DATABASE_DRIVER_UNAVAILABLE",
          "Database driver is unavailable.",
          503,
        );
      try {
        if (operation === "test") {
          await adapter.testConnection(input.connection);
          return c.json({ ok: true });
        }
        if (operation === "resources")
          return c.json(await adapter.listResources(input.connection));
        if (operation === "inspect")
          return c.json(await adapter.inspect(input.connection, raw.resource));
        if (operation === "read")
          return c.json(await adapter.read(databaseReadSchema.parse(input)));
        return c.json(
          await adapter.mutate(databaseMutationSchema.parse(input)),
        );
      } catch (error) {
        throw databaseError(error, operation === "mutate");
      }
    });
  }
  app.post("/introspect", async (context) => {
    if (!driver)
      return context.json({ error: "Legacy driver unavailable" }, 503);
    const body = z
      .object({
        connection: connectionSchema,
        table: sqlIdentifier.optional(),
      })
      .strict()
      .parse(await context.req.json());
    assertHostAllowed(body.connection.host);
    if (!body.table)
      return context.json({
        tables: await driver!.listTables(body.connection),
      });
    return context.json(await driver!.getColumns(body.connection, body.table));
  });

  app.post("/query", async (context) => {
    if (!driver)
      return context.json({ error: "Legacy driver unavailable" }, 503);
    const input = bridgeQuerySchema.parse(await context.req.json());
    assertHostAllowed(input.connection.host);
    if (input.operation === "list" && input.perPage > 100)
      fail("Máximo 100 registros por página.");
    return context.json(await driver!.query(input));
  });

  return app;
}
