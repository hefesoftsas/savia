import { createSaviaMcpServer } from "../../mcp/src/server";
import { loadConfiguration } from "./config";
import { createApplication } from "./application";
import { startHttpServer } from "./http-server";

const config = loadConfiguration();
// Private loopback MCP uses delegated user credentials against the shared API.
const mcpSecret = process.env.SAVIA_MCP_SHARED_SECRET ?? config.encryptionKey;
const app = await createApplication(config, {
  ...process.env,
  SAVIA_MCP_URL: "http://127.0.0.1:8789/mcp",
  SAVIA_MCP_SHARED_SECRET: mcpSecret,
});
const mcp = createSaviaMcpServer({
  apiUrl: config.publicOrigin,
  apiFetch: async (input, init) => app.fetch(new Request(input, init)),
  mcpSharedSecret: mcpSecret,
});
await mcp.run({
  transport: "http",
  stateless: true,
  host: "127.0.0.1",
  port: 8789,
});
const http = await startHttpServer({
  ...config,
  fetchApi: app.fetch,
  realtime: app.realtime,
});
const timer = setInterval(() => {
  void app
    .scheduled()
    .catch((error) => console.error("Scheduled work failed", error));
}, 60_000);
timer.unref();
console.log(
  `Savia listening on ${config.host}:${config.port} (public origin ${config.publicOrigin})`,
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    const timeout = setTimeout(() => process.exit(1), 30_000);
    timeout.unref();
    void (async () => {
      app.realtime.close();
      await http.close();
      await mcp.close();
      await app.close();
      clearTimeout(timeout);
    })().catch((error) => {
      console.error("Shutdown failed", error);
      process.exitCode = 1;
    });
  });
