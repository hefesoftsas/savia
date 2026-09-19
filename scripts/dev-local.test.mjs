import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const executeFile = promisify(execFile);

async function localDevelopmentCommands({
  mcpEnabled = true,
  adminPort = null,
  port5173Occupied = false,
  devHost = "127.0.0.1",
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "savia-dev-local-"));
  const output = join(directory, "commands.txt");
  const secrets = join(directory, "secrets");
  const pnpm = join(directory, "pnpm");
  const curl = join(directory, "curl");
  const lsof = join(directory, "lsof");
  await mkdir(secrets);
  await writeFile(
    join(secrets, "assistant-api.dev.env"),
    "OPENROUTER_API_KEY=openrouter-test-key\nASSISTANT_SETTINGS_ENCRYPTION_KEY=base64-test-key\nOPENROUTER_MODEL=test-model\nNANGO_BASE_URL=https://nango.test\nNANGO_CONNECT_URL=https://connect.nango.test\nNANGO_API_KEY=nango-test-key\nNANGO_HUBSPOT_INTEGRATION_ID=hubspot\nNANGO_GOOGLE_DRIVE_INTEGRATION_ID=google-drive\nNANGO_GMAIL_INTEGRATION_ID=gmail\nNANGO_GOOGLE_CALENDAR_INTEGRATION_ID=google-calendar\nNANGO_OUTLOOK_INTEGRATION_ID=outlook\nNANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID=onedrive-personal\nNANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID=onedrive-business\n",
  );
  await writeFile(
    join(secrets, "auth.dev.env"),
    "BETTER_AUTH_SECRET=auth-test-secret\n",
  );
  await writeFile(
    join(secrets, "connector-gateway.dev.env"),
    "EXTENSION_CONNECTIONS_ENCRYPTION_KEY=connector-gateway-test-key\n",
  );
  if (mcpEnabled) {
    await writeFile(
      join(secrets, "mcp.dev.env"),
      "SAVIA_MCP_SHARED_SECRET=test-mcp-secret\n",
    );
  }
  await writeFile(
    pnpm,
    `#!/bin/sh
printf '%s|%s|%s|%s|%s|%s|%s|auth-secret=%s\\n' "$MCP_TRANSPORT" "$MCP_HOST" "$SAVIA_API_URL" "$SAVIA_MCP_URL" "$OPENROUTER_API_KEY" "$SAVIA_MCP_SHARED_SECRET" "$*" "$BETTER_AUTH_SECRET" >> "$TMPDIR/commands.txt"
`,
  );
  await chmod(pnpm, 0o700);
  await writeFile(
    curl,
    `#!/bin/sh
printf 'curl|%s\\n' "$*" >> "$TMPDIR/commands.txt"
`,
  );
  await chmod(curl, 0o700);
  await writeFile(
    lsof,
    `#!/bin/sh
case "$*" in
  *TCP:5173*) exit ${port5173Occupied ? 0 : 1} ;;
esac
exit 1
`,
  );
  await chmod(lsof, 0o700);

  await executeFile("sh", ["scripts/dev-local.sh"], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      SAVIA_SECRETS_DIR: secrets,
      SAVIA_DEV_HOST: devHost,
      TMPDIR: directory,
      ...(adminPort === null ? {} : { SAVIA_ADMIN_PORT: adminPort }),
    },
  });
  return readFile(output, "utf8");
}

test("starts the application locally with the private Savia request Worker", async () => {
  const commands = await localDevelopmentCommands({ adminPort: "5174" });

  assert.match(
    commands,
    /curl\|--fail --silent --max-time 2 http:\/\/127\.0\.0\.1:8788\/_internal\/session/,
  );
  assert.match(
    commands,
    /\|\|\|http:\/\/127\.0\.0\.1:8789\/mcp\|\|\|--filter @savia\/api exec wrangler d1 migrations apply savia-agencies --local --config wrangler\.jsonc/,
  );
  assert.match(
    commands,
    /\|\|\|http:\/\/127\.0\.0\.1:8789\/mcp\|\|\|--filter @savia\/auth exec wrangler dev --local --ip 127\.0\.0\.1 --port 8788 --inspector-port 9230 --config wrangler\.jsonc --var SAVIA_ADMIN_REDIRECT_URI:http:\/\/127\.0\.0\.1:5174\/auth\/callback/,
  );
  assert.match(commands, /--var BETTER_AUTH_SECRET:auth-test-secret/);
  assert.match(
    commands,
    /http\|127\.0\.0\.1\|http:\/\/127\.0\.0\.1:8787\|\|\|test-mcp-secret\|--filter @savia\/mcp start/,
  );
  assert.match(
    commands,
    /--filter @savia\/request exec wrangler dev --local --ip 127\.0\.0\.1 --port 8797 --inspector-port 9232 --config wrangler\.jsonc/,
  );
  assert.match(commands, /exec node scripts\/dev-api-runtime\.mjs/);
  assert.match(commands, /exec node scripts\/crm-sync-local-scheduler\.mjs/);
  assert.doesNotMatch(
    commands,
    /--filter @savia\/legacy-api exec wrangler dev/,
  );
  assert.doesNotMatch(commands, /--var NANGO_API_KEY/);
  assert.match(
    commands,
    /\|\|\|http:\/\/127\.0\.0\.1:8789\/mcp\|\|\|--filter @savia\/admin exec vite --host 127\.0\.0\.1 --port 5174 --strictPort/,
  );
});

test("uses the next free Admin port for both Vite and OAuth", async () => {
  const commands = await localDevelopmentCommands({
    mcpEnabled: false,
    port5173Occupied: true,
  });

  assert.match(
    commands,
    /--config wrangler\.jsonc --var SAVIA_ADMIN_REDIRECT_URI:http:\/\/127\.0\.0\.1:5174\/auth\/callback/,
  );
  assert.match(
    commands,
    /--filter @savia\/admin exec vite --host 127\.0\.0\.1 --port 5174 --strictPort/,
  );
});

test("runs without MCP when its shared secret is absent", async () => {
  const commands = await localDevelopmentCommands({ mcpEnabled: false });

  assert.doesNotMatch(commands, /--filter @savia\/mcp dev/);
  assert.doesNotMatch(commands, /--var SAVIA_MCP_URL/);
  assert.doesNotMatch(commands, /--var SAVIA_MCP_SHARED_SECRET/);
});

test("exposes Admin inside a container while preserving browser OAuth URLs", async () => {
  const commands = await localDevelopmentCommands({
    devHost: "0.0.0.0",
    adminPort: "5173",
  });
  assert.match(commands, /vite --host 0\.0\.0\.0 --port 5173 --strictPort/);
  assert.match(
    commands,
    /SAVIA_ADMIN_REDIRECT_URI:http:\/\/127\.0\.0\.1:5173\/auth\/callback/,
  );
  assert.match(
    commands,
    /@savia\/auth exec wrangler dev --local --ip 127\.0\.0\.1/,
  );
});
