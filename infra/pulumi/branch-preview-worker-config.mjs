import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function workerConfig(
  kind,
  names,
  ids,
  origin,
  { assetsDir, bootstrap, identityReady = true } = {},
) {
  const base = {
    compatibility_date: kind === "request" ? "2026-09-04" : "2026-08-31",
    workers_dev: true,
  };
  if (kind === "auth")
    return {
      ...base,
      name: names.workers.auth,
      main: resolve(workspaceRoot, "apps/auth/src/index.ts"),
      compatibility_flags: ["nodejs_compat"],
      ...(identityReady
        ? {
            services: [
              { binding: "SAVIA_IDENTITY", service: names.workers.api },
            ],
          }
        : {}),
      d1_databases: [
        {
          binding: "AUTH_DB",
          database_name: names.databases.auth,
          database_id: ids.auth,
        },
      ],
      vars: {
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_BOOTSTRAP_EMAIL: "savia.admin@example.test",
        BETTER_AUTH_BOOTSTRAP_PASSWORD: bootstrap?.password ?? "preview-only",
        SAVIA_API_RESOURCE: origin,
        SAVIA_ADMIN_REDIRECT_URI: `${origin}/auth/callback`,
        SAVIA_SCALAR_REDIRECT_URI: `${origin}/docs`,
      },
    };
  if (kind === "request")
    return {
      ...base,
      name: names.workers.request,
      main: resolve(workspaceRoot, "apps/savia-request/src/server/index.ts"),
      workers_dev: false,
      preview_urls: false,
      services: [
        { binding: "HOOK_SERVICE", service: names.workers.hookExecutor },
      ],
      d1_databases: [
        {
          binding: "DB",
          database_name: names.databases.domain,
          database_id: ids.domain,
        },
      ],
    };
  if (kind === "hookExecutor")
    return {
      ...base,
      name: names.workers.hookExecutor,
      main: resolve(workspaceRoot, "apps/hook-executor/src/index.ts"),
      compatibility_date: "2026-09-04",
      workers_dev: false,
      preview_urls: false,
      limits: { cpu_ms: 30000 },
      rules: [
        {
          type: "CompiledWasm",
          globs: ["**/*.wasm"],
          fallthrough: true,
        },
      ],
    };
  if (kind === "mcp")
    return {
      ...base,
      name: names.workers.mcp,
      main: resolve(workspaceRoot, "apps/mcp/src/worker.ts"),
      compatibility_flags: ["nodejs_compat"],
      services: [{ binding: "API", service: names.workers.api }],
      vars: { SAVIA_API_URL: origin },
    };
  if (kind === "api")
    return {
      ...base,
      name: names.workers.api,
      main: resolve(workspaceRoot, "apps/api/src/index.ts"),
      services: [
        { binding: "AUTH", service: names.workers.auth },
        { binding: "MCP", service: names.workers.mcp },
        { binding: "SAVIA_REQUEST", service: names.workers.request },
      ],
      d1_databases: [
        {
          binding: "DB",
          database_name: names.databases.domain,
          database_id: ids.domain,
        },
      ],
      r2_buckets: [{ binding: "DOCUMENTS", bucket_name: names.bucket }],
      vars: {
        SAVIA_API_RESOURCE: origin,
        SAVIA_OAUTH_ISSUER: `${origin}/api/auth`,
        SAVIA_PUBLIC_ORIGIN: origin,
        SAVIA_MCP_URL: `https://${names.workers.mcp}.workers.dev/mcp`,
      },
    };
  return {
    ...base,
    name: names.workers.gateway,
    main: resolve(workspaceRoot, "apps/admin/src/edge-gateway.ts"),
    services: [{ binding: "API", service: names.workers.api }],
    assets: {
      directory: assetsDir ?? resolve(workspaceRoot, "apps/admin/dist"),
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: [
        "/companion-downloads.json",
        "/public/bookings",
        "/public/bookings/*",
        "/public/quotes",
        "/public/quotes/*",
        "/api/*",
        "/v1/*",
        "/webhooks/whatsapp",
        "/s/*",
        "/.well-known/*",
        "/health",
        "/docs",
        "/openapi.json",
      ],
    },
  };
}
