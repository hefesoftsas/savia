import { startCommand } from "./mcp-e2e-process.mjs";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { isolateCompose } from "./mcp-e2e-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = `savia-mcp-e2e-${randomBytes(6).toString("hex")}`;
const directory = await mkdtemp(join(tmpdir(), `${project}-`));
await chmod(directory, 0o700);
const configPath = join(directory, "compose.json");
const envPath = join(directory, "fixture.env");
let active;
let stopping;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = true;
    stopping = active?.stop();
  });

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
async function run(command, args, env = {}, capture = false, cleanup = false) {
  if (interrupted && !cleanup) throw new Error("Interrupted");
  const task = startCommand(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    captureStderr: capture === "all",
  });
  active = task;
  try {
    return await task.done;
  } finally {
    await stopping;
    if (active === task) active = undefined;
  }
}
let started = false;
let success = false;
const compose = ["compose", "--project-name", project, "-f", configPath];
try {
  await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  const appPort = await freePort();
  let storagePort = await freePort();
  while (storagePort === appPort) storagePort = await freePort();
  const origin = `http://localhost:${appPort}`;
  await run(process.execPath, [
    "scripts/configure-self-hosted.mjs",
    "--email",
    "mcp-e2e@example.test",
    "--origin",
    origin,
    "--storage-origin",
    `http://localhost:${storagePort}`,
    "--output",
    envPath,
  ]);
  // Materialize the existing Compose model without starting its default project.
  const base = JSON.parse(
    await run(
      "docker",
      [
        "compose",
        "-f",
        "docker-compose.self-hosted.yml",
        "config",
        "--format",
        "json",
      ],
      { SAVIA_ENV_FILE: envPath },
      true,
    ),
  );
  await writeFile(
    configPath,
    JSON.stringify(isolateCompose(base, project, appPort, storagePort)),
    { mode: 0o600 },
  );
  console.log(
    `Disposable project: ${project}; private artifacts: ${directory}`,
  );
  await run("docker", [...compose, "build", "savia"]);
  started = true;
  await run("docker", [
    ...compose,
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "180",
  ]);
  const values = Object.fromEntries(
    (await readFile(envPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  await run(
    "pnpm",
    [
      "--filter",
      "@savia/self-hosted",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.config.mjs",
    ],
    {
      SAVIA_E2E_ORIGIN: origin,
      SAVIA_E2E_PROJECT: project,
      SAVIA_E2E_EMAIL: values.SAVIA_BOOTSTRAP_EMAIL,
      SAVIA_E2E_PASSWORD: values.SAVIA_BOOTSTRAP_PASSWORD,
      SAVIA_E2E_OUTPUT: join(directory, "playwright"),
    },
  );
  success = true;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      const logs = await run(
        "docker",
        [...compose, "logs", "--no-color"],
        {},
        "all",
        true,
      );
      await writeFile(join(directory, "docker.log"), logs, { mode: 0o600 });
    } catch {
      /* Cleanup must continue even if logs are unavailable. */
    }
    try {
      await run(
        "docker",
        [...compose, "down", "--volumes", "--remove-orphans"],
        {},
        false,
        true,
      );
      await run("docker", ["image", "rm", `${project}:local`], {}, false, true);
    } catch {
      console.error(`Cleanup failed; inspect disposable project ${project}.`);
      process.exitCode = 1;
      success = false;
    }
  }
  if (success) await rm(directory, { recursive: true });
  else
    console.error(
      `Private failure artifacts retained at ${directory}. They may contain test-only credentials; do not publish them.`,
    );
}
