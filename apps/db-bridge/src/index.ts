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

const app = createDbBridgeApp({
  driver: createPgDriver(),
  sharedSecret: secret,
  allowedHosts: process.env.DB_BRIDGE_ALLOWED_HOSTS,
});

if ((process.env.DB_BRIDGE_ALLOWED_HOSTS ?? "*").trim() === "*") {
  console.warn(
    "[db-bridge] DB_BRIDGE_ALLOWED_HOSTS=* : cualquier host Postgres es alcanzable. Define la lista en producción.",
  );
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[db-bridge] escuchando en http://127.0.0.1:${info.port}`);
});
