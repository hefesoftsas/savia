// Pure naming/validation for Savia Cloudflare infrastructure.
// Mirrors scripts/render-cloudflare-production-config.mjs isolation rules
// so Pulumi stateful resources (D1/R2) can never collide across environments.
// No Pulumi imports here: this file is unit-tested with `node --test`.

export const DEFAULT_DOCUMENTS_BUCKET = "savia-documents";
export const DEFAULT_PUBLIC_ORIGIN = "https://savia.app.hefesoft.com";
export const PREVIEW_PUBLIC_ORIGIN = "https://savia-preview.hefesoft.com";
export const PREVIEW_VECTORIZE_INDEX = "savia-pages-search-preview";
export const BASE_STATE_BUCKET = "savia-pulumi-state";

export const BASE_WORKERS = Object.freeze({
  auth: "savia-auth",
  api: "savia-agencies",
  request: "savia-request",
  hookExecutor: "savia-hook-executor",
  connectors: "savia-connectors",
  mcp: "savia-mcp",
  gateway: "savia",
});

export const BASE_DATABASES = Object.freeze({
  auth: "savia-auth",
  domain: "savia-agencies",
});

const BASE_FLOWS = Object.freeze({
  worker: "savia-flows",
  database: "savia-flows",
  kvNamespace: "savia-flows",
  buckets: Object.freeze({
    resources: "savia-flows-resources",
    datasets: "savia-flows-datasets",
    inboxes: "savia-flows-inboxes",
  }),
  queue: "savia-flows-execute",
  deadLetterQueue: "savia-flows-execute-dlq",
  workflow: "savia-flows-execute",
});

export function normalizeEnvironment(environment) {
  if (environment !== "preview" && environment !== "production") {
    throw new Error("environment must be preview or production");
  }
  return environment;
}

function requiredValue(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function originValue(value) {
  const origin = new URL(value ?? DEFAULT_PUBLIC_ORIGIN);
  if (origin.protocol !== "https:") {
    throw new Error("publicOrigin must use HTTPS");
  }
  return origin.origin;
}

export function workerName(base, environment) {
  normalizeEnvironment(environment);
  return environment === "preview" ? `${base}-preview` : base;
}

export function databaseName(base, environment) {
  normalizeEnvironment(environment);
  return environment === "preview" ? `${base}-preview` : base;
}

export function stateBackendName(environment, configuredName) {
  const env = normalizeEnvironment(environment);
  if (configuredName === undefined) return undefined;
  if (typeof configuredName !== "string" || configuredName.trim() === "") {
    throw new Error("stateBucket must be a non-empty bucket name");
  }
  const name = configuredName.trim();
  if (name === DEFAULT_DOCUMENTS_BUCKET || name === "savia-documents-preview") {
    throw new Error("stateBucket must be separate from the documents bucket");
  }
  const expected =
    env === "preview" ? `${BASE_STATE_BUCKET}-preview` : BASE_STATE_BUCKET;
  if (name !== expected) {
    throw new Error(`stateBucket must be ${expected} for ${env}`);
  }
  return expected;
}

export function stateBackendUrl(accountId, bucketName) {
  const account = assertAccountId(accountId);
  if (typeof bucketName !== "string" || bucketName.trim() === "") {
    throw new Error("state backend bucket name is required");
  }
  return `s3://${bucketName.trim()}?endpoint=${account}.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true`;
}

// Resolves deterministic infra names + validates preview/production isolation.
// Same guardrails as render-cloudflare-production-config.mjs:
// preview requires its own bucket, origin, and search index.
export function resolveInfraNames({
  environment,
  documentsBucket = DEFAULT_DOCUMENTS_BUCKET,
  pagesSearchIndex,
  publicOrigin = DEFAULT_PUBLIC_ORIGIN,
}) {
  const env = normalizeEnvironment(environment);
  const bucket = requiredValue(documentsBucket, "documentsBucket");
  const origin = originValue(publicOrigin);
  const searchIndex = pagesSearchIndex?.trim() || undefined;

  if (env === "preview") {
    if (
      bucket === DEFAULT_DOCUMENTS_BUCKET ||
      origin !== PREVIEW_PUBLIC_ORIGIN
    ) {
      throw new Error(
        "preview requires an isolated documents bucket and public origin",
      );
    }
    if (searchIndex && searchIndex !== PREVIEW_VECTORIZE_INDEX) {
      throw new Error("Preview requires an isolated Pages search index");
    }
  }
  if (env === "production") {
    if (searchIndex === PREVIEW_VECTORIZE_INDEX) {
      throw new Error("Production cannot use the preview Pages search index");
    }
  }

  return Object.freeze({
    environment: env,
    publicOrigin: origin,
    bucket,
    vectorizeIndex: searchIndex,
    workers: Object.freeze(
      Object.fromEntries(
        Object.entries(BASE_WORKERS).map(([key, base]) => [
          key,
          workerName(base, env),
        ]),
      ),
    ),
    databases: Object.freeze({
      auth: databaseName(BASE_DATABASES.auth, env),
      domain: databaseName(BASE_DATABASES.domain, env),
    }),
    flows: Object.freeze({
      worker: workerName(BASE_FLOWS.worker, env),
      database: databaseName(BASE_FLOWS.database, env),
      kvNamespace: databaseName(BASE_FLOWS.kvNamespace, env),
      buckets: Object.freeze(
        Object.fromEntries(
          Object.entries(BASE_FLOWS.buckets).map(([key, base]) => [
            key,
            databaseName(base, env),
          ]),
        ),
      ),
      queue: databaseName(BASE_FLOWS.queue, env),
      deadLetterQueue: databaseName(BASE_FLOWS.deadLetterQueue, env),
      workflow: databaseName(BASE_FLOWS.workflow, env),
    }),
  });
}

// Validate the optional Flows resource outputs before they are serialized
// into the Worker deployment manifest. The Worker remains Wrangler-owned.
export function validateFlowsResources(resources, environment) {
  if (resources === null || resources === undefined) return null;
  const env = normalizeEnvironment(environment);
  const names = resolveInfraNames({
    environment: env,
    documentsBucket:
      env === "preview" ? "savia-documents-preview" : DEFAULT_DOCUMENTS_BUCKET,
    publicOrigin:
      env === "preview" ? PREVIEW_PUBLIC_ORIGIN : DEFAULT_PUBLIC_ORIGIN,
  }).flows;
  const requiredId = (value, label) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Flows resource output ${label} is required`);
    }
    return value.trim();
  };
  for (const [key, expected] of [
    ["workerName", names.worker],
    ["workflowName", names.workflow],
    ["queueName", names.queue],
  ]) {
    if (resources?.[key] !== expected) {
      throw new Error(`Flows resource output ${key} does not match ${env}`);
    }
  }
  if (
    resources.deadLetterQueueName !== undefined &&
    resources.deadLetterQueueName !== names.deadLetterQueue
  ) {
    throw new Error(
      `Flows resource output deadLetterQueueName does not match ${env}`,
    );
  }
  if (!resources.buckets || typeof resources.buckets !== "object") {
    throw new Error("Flows resource output buckets are required");
  }
  for (const [key, expected] of Object.entries(names.buckets)) {
    if (resources.buckets[key] !== expected) {
      throw new Error(
        `Flows resource output buckets.${key} does not match ${env}`,
      );
    }
  }
  return Object.freeze({
    databaseId: requiredId(resources.databaseId, "databaseId"),
    kvNamespaceId: requiredId(resources.kvNamespaceId, "kvNamespaceId"),
    workerName: names.worker,
    workflowName: names.workflow,
    queueName: names.queue,
    ...(resources.deadLetterQueueName !== undefined
      ? { deadLetterQueueName: names.deadLetterQueue }
      : {}),
    buckets: names.buckets,
  });
}

// Maps Pulumi stack outputs to the env vars consumed by
// scripts/render-cloudflare-production-config.mjs and CI.
export function exportsForRender({ authD1Id, domainD1Id, names }) {
  return Object.freeze({
    SAVIA_AUTH_D1_ID: requiredValue(authD1Id, "authD1Id"),
    SAVIA_DOMAIN_D1_ID: requiredValue(domainD1Id, "domainD1Id"),
    SAVIA_DOCUMENTS_BUCKET: names.bucket,
    SAVIA_PUBLIC_ORIGIN: names.publicOrigin,
    SAVIA_DEPLOY_ENVIRONMENT: names.environment,
  });
}

// Cloudflare account IDs are 32 lowercase hex chars. Validating before
// interpolating into API URLs / endpoints (CodeQL: incomplete URL
// sanitization) and failing fast on typos.
export function assertAccountId(accountId) {
  if (typeof accountId !== "string" || !/^[0-9a-f]{32}$/.test(accountId))
    throw new Error("accountId must be a 32-char lowercase hex string");
  return accountId;
}

// R2 keys become local file paths in backups. Reject traversal and
// absolute paths: tenant-controlled names must never escape destDir.
export function assertSafeR2Key(key) {
  if (
    typeof key !== "string" ||
    key === "" ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").includes("..")
  )
    throw new Error(`Refusing unsafe R2 key: ${key}`);
  return key;
}

// Deletion protection per stack. Production resources are created with
// Pulumi `protect: true` and destroying the stack additionally requires
// an explicit acknowledgement flag (see destroy.mjs). Preview stacks stay
// cheap to tear down.
export function stackProtection(environment) {
  const env = normalizeEnvironment(environment);
  const production = env === "production";
  return Object.freeze({
    environment: env,
    protect: production,
    destroyRequires: production
      ? "--i-understand-destroy-production"
      : "--apply",
  });
}
