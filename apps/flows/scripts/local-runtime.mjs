import { randomBytes } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

/** All product egress is denied, including loopback and credentialed requests. */
export function denyExternalServices() {
  return Response.json(
    {
      error: {
        code: "EXTERNAL_SERVICES_DISABLED",
        message:
          "Savia Flows runs locally. External services require explicit authorization and are disabled.",
      },
    },
    { status: 503 },
  );
}

export function createLocalOptions({
  script,
  scriptPath,
  persist = false,
  port = 8796,
  minimal = false,
  bridgeSecret,
  secretMasterKey,
  formSigningKey,
  workerOptions = {},
  registryPath,
  publicOrigin = "http://127.0.0.1:5173",
} = {}) {
  const origin = new URL(publicOrigin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
    origin.username ||
    origin.password
  )
    throw new Error("Local Savia Flows requires a loopback public origin.");
  const bindings = {
    WEB_HOST: origin.origin + "/flows-ui",
    WEBSITE_URL: origin.origin,
    EMAIL_DOMAIN: "savia.local",
    CLOUDFLARE_ENV: "development",
    SAVIA_FLOWS_LOCAL_ONLY: "true",
    SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED: "false",
    SAVIA_FLOWS_POLICY_GENERATION: String(Date.now()),
    JWT_SECRET: randomBytes(32).toString("hex"),
    SAVIA_FLOWS_BRIDGE_SECRET: bridgeSecret ?? randomBytes(32).toString("hex"),
    SECRET_MASTER_KEY: secretMasterKey ?? randomBytes(32).toString("hex"),
    FORM_SIGNING_KEY: formSigningKey ?? randomBytes(32).toString("hex"),
    ...workerOptions.bindings,
  };
  // No process.env spread. A shell's cloud credentials never enter this Worker.
  delete bindings.CLOUDFLARE_API_TOKEN;
  delete bindings.CLOUDFLARE_ACCOUNT_ID;
  const worker = {
    ...workerOptions,
    name: "savia-flows",
    modules: workerOptions.modules ?? true,
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    ...(Array.isArray(workerOptions.modules)
      ? {}
      : script !== undefined
        ? { script }
        : { scriptPath }),
    bindings,
    d1Databases: { DB: "savia-flows-local" },
    r2Buckets: {
      RESSOURCES: "savia-flows-resources",
      DATASETS: "savia-flows-datasets",
      INBOXES: "savia-flows-inboxes",
    },
    kvNamespaces: { KV: "savia-flows-kv" },
    outboundService: denyExternalServices,
    ...(minimal
      ? {}
      : {
          serviceBindings: {
            CODE_EXECUTOR: {
              name: "savia-hook-executor",
              entrypoint: "FlowsExecutor",
            },
            SAVIA_HOST: "savia-agencies",
            ...workerOptions.serviceBindings,
          },
          durableObjects: Object.fromEntries(
            Object.entries({
              DATABASE: "DatabaseDO",
              WORKFLOW_AGENT: "WorkflowAgent",
              AGENT_RUNNER: "AgentRunner",
              EMAIL_AGENT_RUNNER: "EmailAgentRunner",
              MAILBOX: "MailboxDO",
            }).map(([binding, className]) => [
              binding,
              { className, useSQLite: true },
            ]),
          ),
          workflows: {
            EXECUTE: { name: "savia-flows-local", className: "Runtime" },
          },
          queueProducers: { WORKFLOW_QUEUE: "savia-flows-local" },
          queueConsumers: {
            "savia-flows-local": { maxBatchSize: 10, maxBatchTimeout: 1 },
          },
          ratelimits: {
            RATE_LIMIT_DEFAULT: {
              namespace_id: "7001",
              simple: { limit: 1000, period: 60 },
            },
            RATE_LIMIT_AUTH: {
              namespace_id: "7002",
              simple: { limit: 100, period: 60 },
            },
            RATE_LIMIT_EXECUTE: {
              namespace_id: "7003",
              simple: { limit: 100, period: 60 },
            },
          },
        }),
  };
  // Explicit local namespace persistence; no remote binding or container proxy.
  return {
    host: "127.0.0.1",
    port,
    cf: false,
    unsafeDevRegistryPath: registryPath,
    resourcePersistencePath: persist === false ? undefined : persist,
    workers: [worker],
  };
}

export function createManagedLocalRuntime(options) {
  const nativeOptions = convertV4MiniflareOptions(options);
  const runtime = new Miniflare(nativeOptions);
  const dispose = runtime.dispose.bind(runtime);
  let disposal;
  runtime.dispose = () => {
    disposal ??= (async () => {
      // Miniflare 5's registry watcher can race shutdown after queue activity.
      // Withdraw and close it before stopping the Worker processes.
      try {
        if (nativeOptions.unsafeDevRegistryPath) {
          const names = new Set(
            nativeOptions.workers.map((worker) => worker.config.name),
          );
          const workers = nativeOptions.workers.map((worker) => ({
            ...worker,
            config: {
              ...worker.config,
              env: Object.fromEntries(
                Object.entries(worker.config.env ?? {}).filter(
                  ([, binding]) =>
                    binding.type !== "worker" || names.has(binding.worker),
                ),
              ),
            },
          }));
          await runtime.setOptions({
            ...nativeOptions,
            workers,
            unsafeDevRegistryPath: undefined,
          });
        }
      } finally {
        await dispose();
      }
    })();
    return disposal;
  };
  return runtime;
}

export async function createLocalRuntime(options) {
  const runtime = createManagedLocalRuntime(createLocalOptions(options));
  try {
    await runtime.ready;
    return runtime;
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
