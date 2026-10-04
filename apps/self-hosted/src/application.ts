import { createCollectionGateway } from "../../api/src/studio/collection-gateway";
import { createNativeCollectionFetch } from "./outbound-fetch";
import { mkdirSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  createApiRuntime,
  type RuntimeEnvironment,
} from "../../api/src/runtime";
import { createAuthHandler } from "../../auth/src/index";
import requestApp from "../../savia-request/src/server/index";
import { createRuntimeConnectorApp } from "../../connector-gateway/src/index";
import { openDatabases } from "./databases";
import { createObjectStore } from "./object-store";
import { createNodeHookExecutor } from "./hooks";
import { createNodeRealtimeHub } from "./realtime";
import { createRateLimiter } from "./rate-limit";
import type { Configuration } from "./config";
import { createPagesSearchBindings } from "./pages-search";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function isNonPublicAddress(address: string): boolean {
  const value = address.toLowerCase().split("%")[0];
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (isIP(value) === 6) {
    if (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe80:")
    )
      return true;
    if (value.startsWith("::ffff:")) return isNonPublicAddress(value.slice(7));
    return false;
  }
  return true;
}

function localSmtpHost(host: string): boolean {
  return ["localhost", "mailpit", "127.0.0.1", "::1"].includes(
    host.trim().toLowerCase(),
  );
}

async function resolveSmtpTarget(
  settings: import("../../auth/src/smtp").SMTPSettings,
): Promise<{ host: string; servername?: string; localDevelopment: boolean }> {
  const host = settings.host.trim().toLowerCase();
  const localDevelopment = settings.allowInsecure === true;
  if (localDevelopment && localSmtpHost(host))
    return { host, localDevelopment: true };
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!isIP(host) && !host.includes("."))
  )
    throw new Error("SMTP host must resolve to a public address");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => isNonPublicAddress(address))
  )
    throw new Error("SMTP host must resolve only to public addresses");
  return {
    host: addresses[0].address,
    ...(isIP(host) ? {} : { servername: host }),
    localDevelopment: false,
  };
}

function makeSmtpTransport(
  settings: import("../../auth/src/smtp").SMTPSettings,
  target: { host: string; servername?: string; localDevelopment: boolean },
) {
  if (settings.security === "plain" && !target.localDevelopment)
    throw new Error("Unencrypted SMTP is only allowed for local development");
  if (Boolean(settings.username) !== Boolean(settings.password))
    throw new Error("SMTP username and password must be set together");
  return nodemailer.createTransport({
    host: target.host,
    port: settings.port,
    secure: settings.security === "tls",
    requireTLS: settings.security === "starttls",
    connectionTimeout: settings.timeoutMs ?? 15_000,
    socketTimeout: settings.timeoutMs ?? 15_000,
    ...(target.servername ? { tls: { servername: target.servername } } : {}),
    ...(settings.username
      ? { auth: { user: settings.username, pass: settings.password } }
      : {}),
  });
}

export async function createApplication(
  config: Configuration,
  env: Record<string, string | undefined> = process.env,
) {
  const searchShutdown = new AbortController();
  const pagesSearch = createPagesSearchBindings(
    env,
    fetch,
    searchShutdown.signal,
  );
  const backgroundTasks = new Set<Promise<unknown>>();
  mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
  const stores = openDatabases(config, repositoryRoot);
  const {
    core: database,
    auth: authDatabase,
    request: requestDatabase,
  } = stores;
  const objects = createObjectStore(config.s3);
  const realtime = createNodeRealtimeHub();
  const outbound = createNativeCollectionFetch();
  let apiRuntime: ReturnType<typeof createApiRuntime> | undefined;
  const identityService = {
    fetch: async (request: Request) =>
      apiRuntime
        ? apiRuntime.fetch(request)
        : Response.json(
            { error: "Identity service is still initializing." },
            { status: 503 },
          ),
  };
  try {
    const smtpSettings: import("../../auth/src/smtp").SMTPSettings | undefined =
      env.SAVIA_SMTP_HOST
        ? {
            host: env.SAVIA_SMTP_HOST,
            port: Number(env.SAVIA_SMTP_PORT ?? 465),
            security: (env.SAVIA_SMTP_SECURITY ??
              "tls") as import("../../auth/src/smtp").SMTPSettings["security"],
            username: env.SAVIA_SMTP_USERNAME ?? "",
            password: env.SAVIA_SMTP_PASSWORD ?? "",
            from: env.SAVIA_SMTP_FROM ?? "",
            allowInsecure: env.SAVIA_SMTP_ALLOW_INSECURE === "true",
            timeoutMs: 15_000,
          }
        : undefined;
    const internalBridgeKey =
      env.SAVIA_INTERNAL_BRIDGE_KEY?.trim() ||
      createHmac(
        "sha256",
        env.SAVIA_MCP_SHARED_SECRET?.trim() ||
          config.authSecret ||
          config.encryptionKey,
      )
        .update("savia:auth-tenant-user-administration:v1")
        .digest("hex");
    if (smtpSettings && !env.SAVIA_SMTP_FROM)
      throw new Error("SAVIA_SMTP_FROM is required with SMTP");
    const auth = createAuthHandler(
      {
        AUTH_DB: authDatabase,
        BETTER_AUTH_URL: config.publicOrigin,
        BETTER_AUTH_SECRET: config.authSecret,
        SAVIA_SMTP_HOST: env.SAVIA_SMTP_HOST,
        SAVIA_SMTP_PORT: env.SAVIA_SMTP_PORT,
        SAVIA_SMTP_USERNAME: env.SAVIA_SMTP_USERNAME,
        SAVIA_SMTP_PASSWORD: env.SAVIA_SMTP_PASSWORD,
        SAVIA_SMTP_FROM: env.SAVIA_SMTP_FROM,
        SAVIA_SMTP_SECURITY: env.SAVIA_SMTP_SECURITY as
          "tls" | "starttls" | "plain" | undefined,
        SAVIA_SMTP_ALLOW_INSECURE: env.SAVIA_SMTP_ALLOW_INSECURE,
        SAVIA_SSO_ALLOW_LOCAL_IDP: env.SAVIA_SSO_ALLOW_LOCAL_IDP,
        SAVIA_GOOGLE_CLIENT_ID: env.SAVIA_GOOGLE_CLIENT_ID,
        SAVIA_GOOGLE_CLIENT_SECRET: env.SAVIA_GOOGLE_CLIENT_SECRET,
        SAVIA_CHATGPT_CLIENT_ID: env.SAVIA_CHATGPT_CLIENT_ID,
        SAVIA_CHATGPT_CLIENT_SECRET: env.SAVIA_CHATGPT_CLIENT_SECRET,
        SAVIA_CHATGPT_TOKEN_AUTH_METHOD: env.SAVIA_CHATGPT_TOKEN_AUTH_METHOD,
        SAVIA_MICROSOFT_CLIENT_ID: env.SAVIA_MICROSOFT_CLIENT_ID,
        SAVIA_MICROSOFT_CLIENT_SECRET: env.SAVIA_MICROSOFT_CLIENT_SECRET,
        BETTER_AUTH_BOOTSTRAP_EMAIL: config.bootstrapEmail,
        BETTER_AUTH_BOOTSTRAP_PASSWORD: config.bootstrapPassword,
        SAVIA_API_RESOURCE: config.publicOrigin,
        SAVIA_ADMIN_REDIRECT_URI: `${config.publicOrigin}/auth/callback`,
        SAVIA_SCALAR_REDIRECT_URI: `${config.publicOrigin}/docs`,
        SAVIA_INTERNAL_BRIDGE_KEY: internalBridgeKey,
        SAVIA_IDENTITY: identityService,
      },
      {
        database: stores.authDatabase,
        deliverEmail: async (
          settings: import("../../auth/src/smtp").SMTPSettings,
          email: import("../../auth/src/smtp").SMTPEmail,
        ) => {
          const target = await resolveSmtpTarget(settings);
          const transport = makeSmtpTransport(settings, target);
          try {
            await transport.sendMail({ ...email, from: settings.from });
          } finally {
            transport.close();
          }
        },
        ...(smtpSettings
          ? {
              sendTransactionalEmail: async (
                email: import("../../auth/src/smtp").SMTPEmail,
              ) => {
                const target = await resolveSmtpTarget(smtpSettings);
                const transport = makeSmtpTransport(smtpSettings, target);
                try {
                  await transport.sendMail({
                    ...email,
                    from: env.SAVIA_SMTP_FROM,
                  });
                } finally {
                  transport.close();
                }
              },
            }
          : {}),
      },
    );
    const encryptionKey = createHash("sha256")
      .update(config.encryptionKey)
      .digest("base64");
    const requestEnvironment = {
      DB: requestDatabase,
      ENCRYPTION_KEY: encryptionKey,
      HOOK_EXECUTOR: createNodeHookExecutor(),
    };
    const requestService = {
      fetch: async (request: Request) =>
        requestApp.fetch(request, requestEnvironment),
    };
    const connectors = createRuntimeConnectorApp({
      DB: database,
      EXTENSION_CONNECTIONS_ENCRYPTION_KEY: encryptionKey,
      SAVIA_REQUEST: requestService,
    });
    const optional = Object.fromEntries(
      [
        "SAVIA_MCP_URL",
        "SAVIA_MCP_SHARED_SECRET",
        "SAVIA_INTERNAL_BRIDGE_KEY",
        "OPENROUTER_API_KEY",
        "OPENROUTER_MODEL",
        "COMPANION_ENABLED",
        "COMPANION_STT_MODEL",
        "NANGO_API_KEY",
        "NANGO_BASE_URL",
        "NANGO_CONNECT_URL",
        "NANGO_HUBSPOT_INTEGRATION_ID",
        "NANGO_SALESFORCE_INTEGRATION_ID",
        "NANGO_ZOHO_INTEGRATION_ID",
        "NANGO_PIPEDRIVE_INTEGRATION_ID",
        "NANGO_GOOGLE_DRIVE_INTEGRATION_ID",
        "NANGO_GMAIL_INTEGRATION_ID",
        "NANGO_GOOGLE_CALENDAR_INTEGRATION_ID",
        "NANGO_OUTLOOK_INTEGRATION_ID",
        "NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID",
        "NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID",
        "NANGO_JIRA_INTEGRATION_ID",
        "NANGO_JIRA_REPORTING_CONNECTION_ID",
        "NANGO_LINEAR_INTEGRATION_ID",
        "NANGO_GITHUB_INTEGRATION_ID",
        "PLUGIN_REGISTRY_TENANTS",
        "SQL_BRIDGE_URL",
        "SQL_BRIDGE_SECRET",
      ].flatMap((key) => (env[key] ? [[key, env[key]]] : [])),
    );
    if (internalBridgeKey)
      optional.SAVIA_INTERNAL_BRIDGE_KEY = internalBridgeKey;
    const environment: RuntimeEnvironment = {
      ...optional,
      ...pagesSearch,
      DB: database,
      DOCUMENTS: objects as unknown as R2Bucket,
      AUTH: auth,
      SAVIA_REQUEST: requestService,
      CONNECTOR_GATEWAY: {
        fetch: async (request) => connectors.fetch(request),
      },
      SAVIA_PUBLIC_ORIGIN: config.publicOrigin,
      SAVIA_API_RESOURCE: config.publicOrigin,
      SAVIA_OAUTH_ISSUER: `${config.publicOrigin}/api/auth`,
      CRM_INTEGRATION_KEY: config.encryptionKey,
      ASSISTANT_SETTINGS_ENCRYPTION_KEY: config.encryptionKey,
      EXTENSION_CONNECTIONS_ENCRYPTION_KEY: encryptionKey,
      REALTIME_RATE_LIMITER: createRateLimiter({ limit: 60 }),
      PUBLIC_FORMS_RATE_LIMITER: createRateLimiter({ limit: 30 }),
    };
    const api = createApiRuntime(environment, {
      pagesSearchSchedule(task) {
        const tracked = task
          .catch(() => {
            console.warn(JSON.stringify({ event: "pages_auto_index_failed" }));
          })
          .finally(() => backgroundTasks.delete(tracked));
        backgroundTasks.add(tracked);
      },
      realtime,
      workflowFetch: outbound.fetch,
      collectionGatewayFactory: (context) =>
        createCollectionGateway({
          ...context,
          collectionFetch: outbound.fetch,
        }),
      signing: { ...config.s3, endpoint: config.s3.publicEndpoint },
      publicForms: {
        captchaProvider: "altcha",
        altchaSecret: config.captchaSecret,
      },
    });
    apiRuntime = api;
    // Initialize authentication before accepting traffic, including bootstrap and OAuth clients.
    await stores.initialize(async () => {
      const startup = await auth.fetch(
        new Request(`${config.publicOrigin}/api/auth/get-session`),
      );
      if (startup.status >= 500)
        throw new Error(
          `Authentication initialization failed (${startup.status})`,
        );
    });
    let scheduled: Promise<void> | undefined;
    return {
      fetch: api.fetch,
      realtime,
      async scheduled() {
        if (scheduled) return scheduled;
        scheduled = api.scheduled().finally(() => {
          scheduled = undefined;
        });
        return scheduled;
      },
      async close() {
        searchShutdown.abort();
        await scheduled?.catch(() => undefined);
        await Promise.allSettled(backgroundTasks);
        realtime.close();
        await outbound.close();
        objects.close();
        await stores.close();
      },
    };
  } catch (error) {
    realtime.close();
    await outbound.close();
    objects.close();
    await stores.close();
    throw error;
  }
}
