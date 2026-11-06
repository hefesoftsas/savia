import { createPostgresDatabaseDriver } from "./postgres-driver";
import { createMysqlDriver } from "./mysql-driver";
import { createMssqlDriver } from "./mssql-driver";
import { createMongoDriver } from "./mongodb-driver";
import { serve } from "@hono/node-server";
import { createDbBridgeApp } from "./app";
import { createPgDriver } from "./pg-driver";

const secret = process.env.DB_BRIDGE_SHARED_SECRET?.trim();
if (!secret) {
  console.error(
    "[db-bridge] Falta DB_BRIDGE_SHARED_SECRET. El puente no arranca sin secreto.",
  );
  process.exit(1);
}

const port = Number(process.env.DB_BRIDGE_PORT ?? 8791);
if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
  console.error("[db-bridge] DB_BRIDGE_PORT inválido.");
  process.exit(1);
}

const drivers = {
  postgres: createPostgresDatabaseDriver(),
  mysql: createMysqlDriver(),
  mssql: createMssqlDriver(),
  mongodb: createMongoDriver(),
};
const legacy = createPgDriver();
const app = createDbBridgeApp({
  drivers,
  driver: legacy,
  sharedSecret: secret,
  allowedHosts: process.env.DB_BRIDGE_ALLOWED_HOSTS,
});

if ((process.env.DB_BRIDGE_ALLOWED_HOSTS ?? "*").trim() === "*") {
  console.warn(
    "[db-bridge] DB_BRIDGE_ALLOWED_HOSTS=* : cualquier host Postgres es alcanzable. Define la lista en producción.",
  );
}

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: process.env.DB_BRIDGE_HOST ?? "127.0.0.1",
  },
  (info) => {
    console.log(`[db-bridge] escuchando en http://127.0.0.1:${info.port}`);
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.close(() => {
      void Promise.all([
        ...Object.values(drivers).map((d) => d.close()),
        legacy.close?.(),
      ]).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 15000).unref();
  });
