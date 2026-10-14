import { mkdir, readFile, readdir, writeFile, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import {
  denyExternalServices,
  createManagedLocalRuntime,
} from "./local-runtime.mjs";
import { buildQuickJsExecutorWorker } from "./build-executor.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(new URL("../api/package.json", import.meta.url));
const { unstable_splitSqlQuery: splitSqlQuery } = require("wrangler");

export async function localSecrets(directory = join(root, ".wrangler")) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "local-secrets.json");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const keys = {
      bridgeSecret: randomBytes(32).toString("hex"),
      secretMasterKey: randomBytes(32).toString("hex"),
      formSigningKey: randomBytes(32).toString("hex"),
    };
    try {
      await writeFile(path, JSON.stringify(keys), { mode: 0o600, flag: "wx" });
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
      return JSON.parse(await readFile(path, "utf8"));
    }
    await chmod(path, 0o600);
    return keys;
  }
}

export async function applyLocalMigrations(runtime, bootstrapSecret) {
  const directory = join(root, "api/src/db/migrations");
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    const sql = await readFile(join(directory, name), "utf8");
    const response = await runtime.dispatchFetch(
      "http://savia-flows.bootstrap/",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + bootstrapSecret,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name, statements: splitSqlQuery(sql) }),
      },
    );
    if (!response.ok)
      throw new Error(
        `Local migration ${name} failed: ${await response.text()}`,
      );
    await response.text();
  }
  return names.length;
}

export async function createLocalRuntimeOptions({
  port = 8796,
  persist = join(root, ".wrangler/state"),
  secrets,
  registryPath = process.env.WRANGLER_REGISTRY_PATH,
  publicOrigin = process.env.SAVIA_FLOWS_PUBLIC_ORIGIN ??
    "http://127.0.0.1:5173",
} = {}) {
  const keys = secrets ?? (await localSecrets());
  const bootstrapSecret = randomBytes(32).toString("hex");
  const modulesRoot = join(root, "api/dist");
  const modules = [{ type: "ESModule", path: join(modulesRoot, "index.js") }];
  for (const name of await readdir(modulesRoot)) {
    const type = name.endsWith(".wasm")
      ? "CompiledWasm"
      : /\.(bin|ttf|woff2?)$/.test(name)
        ? "Data"
        : undefined;
    if (type) modules.push({ type, path: join(modulesRoot, name) });
  }
  const { createLocalOptions } = await import("./local-runtime.mjs");
  const options = createLocalOptions({
    scriptPath: join(root, "api/dist/index.js"),
    persist,
    port,
    ...keys,
    registryPath,
    publicOrigin,
    workerOptions: { modulesRoot, modules },
  });
  options.workers.push({
    name: "savia-flows-bootstrap",
    routes: ["http://savia-flows.bootstrap/*"],
    modules: true,
    scriptPath: join(root, "scripts/bootstrap-worker.mjs"),
    compatibilityDate: "2026-09-01",
    bindings: { BOOTSTRAP_SECRET: bootstrapSecret },
    d1Databases: { DB: "savia-flows-local" },
    outboundService: denyExternalServices,
  });
  options.workers.push(await buildQuickJsExecutorWorker());
  return { options, bootstrapSecret };
}

export async function startLocalFlows(input = {}) {
  const { options, bootstrapSecret } = await createLocalRuntimeOptions(input);
  const runtime = createManagedLocalRuntime(options);
  try {
    await runtime.ready;
    const count = await applyLocalMigrations(runtime, bootstrapSecret);
    console.log(
      `Savia Flows: local Miniflare on 127.0.0.1:${options.port}; ${count} migrations checked; external services disabled.`,
    );
    return runtime;
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

/** Local controller only; redirects must never escape the loopback origin. */
export function createLocalCollectionDrain({
  bridgeSecret,
  coreOrigin = "http://127.0.0.1:8787",
  fetchImpl = fetch,
} = {}) {
  const origin = new URL(coreOrigin);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
    origin.username ||
    origin.password
  )
    throw new Error(
      "Savia collection dispatcher requires a local core API origin",
    );
  return async () => {
    const { SignJWT } = require("jose");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("savia-flows")
      .setAudience("savia-flows-outbox-drain")
      .setSubject("savia-local-outbox")
      .setIssuedAt()
      .setExpirationTime("10s")
      .sign(new TextEncoder().encode(bridgeSecret));
    const response = await fetchImpl(
      new URL("/api/public/savia-flows/drain-events", origin),
      {
        method: "POST",
        headers: { authorization: "Bearer " + token },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    await response.text();
    if (!response.ok)
      throw new Error(
        `Savia collection dispatcher returned ${response.status}`,
      );
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const keys = await localSecrets();
  const drainCollectionEvents = createLocalCollectionDrain({
    bridgeSecret: keys.bridgeSecret,
    coreOrigin: process.env.SAVIA_FLOWS_CORE_ORIGIN,
  });
  const runtime = await startLocalFlows({
    port: Number(process.env.SAVIA_FLOWS_PORT ?? 8796),
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(
      signal,
      () => void runtime.dispose().finally(() => process.exit()),
    );
  async function tick() {
    const { SignJWT } = require("jose");
    const token = await new SignJWT({
      name: "Local scheduler",
      organization: null,
      platformAdmin: true,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("savia")
      .setAudience("savia-flows")
      .setSubject("savia-local-scheduler")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode(keys.bridgeSecret));
    const response = await runtime.dispatchFetch(
      "https://savia-flows.internal/_local/scheduled",
      {
        method: "POST",
        headers: { "x-savia-flows-context": token },
      },
    );
    if (!response.ok) throw new Error(await response.text());
    await response.text();
  }
  setInterval(() => {
    void tick().catch((error) =>
      console.error("Local schedule failed:", error.message),
    );
  }, 60_000).unref();

  // Recover pending collection events even when the core API receives no writes.
  // This is a local development controller; runtime nodes still have denied egress.
  let draining = false;
  setInterval(() => {
    if (draining) return;
    draining = true;
    void drainCollectionEvents()
      .catch((error) =>
        console.error("Local collection delivery failed:", error.message),
      )
      .finally(() => {
        draining = false;
      });
  }, 10_000).unref();
}
