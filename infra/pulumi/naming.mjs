// Pure naming/validation for Savia Cloudflare infrastructure.
// Mirrors scripts/render-cloudflare-production-config.mjs isolation rules
// so Pulumi stateful resources (D1/R2) can never collide across environments.
// No Pulumi imports here: this file is unit-tested with `node --test`.

export const DEFAULT_DOCUMENTS_BUCKET = "savia-documents";
export const DEFAULT_PUBLIC_ORIGIN = "https://savia.app.hefesoft.com";
export const PREVIEW_PUBLIC_ORIGIN = "https://savia-preview.hefesoft.com";
export const PREVIEW_VECTORIZE_INDEX = "savia-pages-search-preview";

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
