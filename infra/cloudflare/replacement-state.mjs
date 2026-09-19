// Anonymized historical examples; obtain a fresh private inventory before planning deletions.
export const legacyResources = Object.freeze({
  workers: ["savia"],
  d1: [
    "savia-core",
    "savia-legacy-quotes",
    "savia-core-develop",
    "savia-legacy-quotes-develop",
    "savia-core-qa",
    "savia-legacy-quotes-qa",
  ],
  r2: [
    "savia-documents-develop",
    "savia-documents-production",
    "savia-documents-qa",
  ],
  kv: [
    "savia-oauth-develop",
    "savia-oauth-production",
    "savia-oauth-qa",
    "savia-quote-api-cache-develop",
    "savia-quote-api-cache-production",
    "savia-quote-api-cache-qa",
    "savia-sessions-develop",
    "savia-sessions-production",
    "savia-sessions-qa",
    "savia-system-control-develop",
    "savia-system-control-production",
    "savia-system-control-qa",
  ],
  queues: [
    "savia-async-jobs-develop",
    "savia-async-jobs-production",
    "savia-async-jobs-qa",
    "savia-email-delivery-events-develop",
    "savia-email-delivery-events-production",
    "savia-email-delivery-events-qa",
  ],
});

const replacementCommands = new Set([
  "inventory",
  "provision",
  "deploy-next",
  "verify",
  "cutover",
  "cleanup",
  "deploy-exporter",
  "export",
  "freeze-exporter",
  "cleanup-legacy-data",
  "deploy-final",
  "remove-temporary",
]);

const mutatingCommands = new Set([
  "provision",
  "deploy-next",
  "verify",
  "cutover",
  "cleanup",
  "deploy-exporter",
  "export",
  "freeze-exporter",
  "cleanup-legacy-data",
  "deploy-final",
  "remove-temporary",
]);

function resourceNames(resources, kind) {
  const values = resources[kind] ?? [];
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string")
  )
    throw new Error(`Deletion inventory ${kind} must be an array of names`);
  return values;
}

export function parseReplacementArgs(argv) {
  const [command, ...flags] = argv;
  if (!command || !replacementCommands.has(command))
    throw new Error(`Unknown replacement command: ${command ?? ""}`);
  const apply = flags.includes("--apply");
  if (mutatingCommands.has(command) && !apply)
    throw new Error(`${command} requires --apply`);
  return { command, apply };
}

export function assertDeletionInventory(inventory) {
  for (const kind of Object.keys(legacyResources)) {
    const approved = new Set(legacyResources[kind]);
    for (const name of resourceNames(inventory, kind)) {
      if (!approved.has(name))
        throw new Error(
          `${kind} resource ${name} is not approved for deletion`,
        );
    }
  }
  return inventory;
}

export function validateState(state) {
  const required = [
    "accountId",
    "accountSubdomain",
    "publicOrigin",
    "domainD1Id",
    "authD1Id",
    "documentsBucket",
    "stagingBucket",
  ];
  for (const key of required) {
    if (typeof state?.[key] !== "string" || state[key].trim() === "")
      throw new Error(`Replacement state requires ${key}`);
  }
  const publicOrigin = new URL(state.publicOrigin);
  if (publicOrigin.protocol !== "https:")
    throw new Error("Replacement publicOrigin must use HTTPS");
  return Object.freeze({ ...state, publicOrigin: publicOrigin.origin });
}

function publicOriginForStage(state, stage) {
  return stage === "next"
    ? `https://savia-next.${state.accountSubdomain}.workers.dev`
    : state.publicOrigin;
}

function stageNames(stage) {
  const suffix = stage === "next" ? "-next" : "";
  return {
    gateway: `savia${suffix}`,
    api: `savia-agencies${suffix}`,
    auth: `savia-auth${suffix}`,
  };
}

function apiConfig(state, stage) {
  const names = stageNames(stage);
  const publicOrigin = publicOriginForStage(state, stage);
  return {
    name: names.api,
    main: "src/index.ts",
    compatibility_date: "2026-08-31",
    services: [{ binding: "AUTH", service: names.auth }],
    d1_databases: [
      {
        binding: "DB",
        database_name: "savia-agencies",
        database_id: state.domainD1Id,
        migrations_dir: "../../packages/db/migrations",
      },
    ],
    r2_buckets: [{ binding: "DOCUMENTS", bucket_name: state.documentsBucket }],
    vars: {
      SAVIA_PUBLIC_ORIGIN: publicOrigin,
      SAVIA_API_RESOURCE: publicOrigin,
      SAVIA_OAUTH_ISSUER: `${publicOrigin}/api/auth`,
    },
  };
}

function authConfig(state, stage) {
  const names = stageNames(stage);
  const publicOrigin = publicOriginForStage(state, stage);
  return {
    name: names.auth,
    main: "src/index.ts",
    compatibility_date: "2026-08-31",
    d1_databases: [
      {
        binding: "AUTH_DB",
        database_name: "savia-auth",
        database_id: state.authD1Id,
      },
    ],
    vars: {
      BETTER_AUTH_URL: publicOrigin,
      SAVIA_API_RESOURCE: publicOrigin,
      SAVIA_ADMIN_REDIRECT_URI: `${publicOrigin}/auth/callback`,
      SAVIA_SCALAR_REDIRECT_URI: `${publicOrigin}/docs`,
    },
  };
}

function gatewayConfig(_, stage) {
  const names = stageNames(stage);
  return {
    name: names.gateway,
    main: "src/edge-gateway.ts",
    compatibility_date: "2026-08-31",
    services: [{ binding: "API", service: names.api }],
    assets: {
      directory: "./dist",
      binding: "ASSETS",
      run_worker_first: [
        "/api/*",
        "/v1/*",
        "/.well-known/*",
        "/mcp",
        "/docs",
        "/openapi.json",
      ],
    },
  };
}

export function renderWorkerConfigs(state) {
  const validated = validateState(state);
  return Object.freeze({
    next: Object.freeze({
      gateway: gatewayConfig(validated, "next"),
      api: apiConfig(validated, "next"),
      auth: authConfig(validated, "next"),
    }),
    final: Object.freeze({
      gateway: gatewayConfig(validated, "final"),
      api: apiConfig(validated, "final"),
      auth: authConfig(validated, "final"),
    }),
  });
}
