import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createSaviaMcpServer } from "./server";

export type HttpMcpConfiguration = {
  apiUrl: string;
  host: string;
  port: number;
  sharedSecret: string;
};

function requireEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: "SAVIA_API_URL" | "SAVIA_MCP_SHARED_SECRET",
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required when MCP_TRANSPORT=http`);
  return value;
}

export function readHttpMcpConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): HttpMcpConfiguration {
  const port = Number(environment.MCP_PORT ?? "8789");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MCP_PORT must be an integer between 1 and 65535");
  }

  return {
    apiUrl: requireEnvironmentValue(environment, "SAVIA_API_URL"),
    host: environment.MCP_HOST?.trim() || "127.0.0.1",
    port,
    sharedSecret: requireEnvironmentValue(
      environment,
      "SAVIA_MCP_SHARED_SECRET",
    ),
  };
}

export const server = createSaviaMcpServer({
  apiUrl: process.env.SAVIA_API_URL,
  mcpSharedSecret: process.env.SAVIA_MCP_SHARED_SECRET,
});

export async function runSaviaMcp(): Promise<void> {
  const transport = process.env.MCP_TRANSPORT ?? "stdio";

  if (transport === "stdio") {
    await server.run();
    return;
  }

  if (transport === "http") {
    const configuration = readHttpMcpConfiguration();
    await server.run({
      transport: "http",
      stateless: true,
      host: configuration.host,
      port: configuration.port,
    });
    return;
  }

  throw new Error('MCP_TRANSPORT must be "stdio" or "http"');
}

const entryPoint = process.argv[1];
const isMain =
  Boolean(
    entryPoint && resolve(entryPoint) === fileURLToPath(import.meta.url),
  ) ||
  process.argv.some(
    (arg) => arg.endsWith("src/index.ts") || arg.endsWith("src/index.js"),
  );

if (isMain) {
  await runSaviaMcp();
}
