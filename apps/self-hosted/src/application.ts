import { createCollectionGateway } from "../../api/src/crm/collection-gateway";
import { createNativeCollectionFetch } from "./outbound-fetch";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import {
  createApiRuntime,
  type RuntimeEnvironment,
} from "../../api/src/runtime";
import { createAuthHandler } from "../../auth/src/index";
import requestApp from "../../savia-request/src/server/index";
import { createRuntimeConnectorApp } from "../../connector-gateway/src/index";
import { SqliteDatabase } from "./sqlite";
import { createObjectStore } from "./object-store";
import { createNodeHookExecutor } from "./hooks";
import { createNodeRealtimeHub } from "./realtime";
import { createRateLimiter } from "./rate-limit";
import type { Configuration } from "./config";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export async function createApplication(
  config: Configuration,
  env: Record<string, string | undefined> = process.env,
) {
  mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
  const database = new SqliteDatabase(
    resolve(config.dataDirectory, "core.sqlite"),
  );
  const authDatabase = new SqliteDatabase(
    resolve(config.dataDirectory, "auth.sqlite"),
  );
  const requestDatabase = new SqliteDatabase(
    resolve(config.dataDirectory, "request.sqlite"),
  );
  const objects = createObjectStore(config.s3);
  const realtime = createNodeRealtimeHub();
  const outbound = createNativeCollectionFetch();
  try {
    await database.migrate(resolve(repositoryRoot, "packages/db/migrations"));
    await requestDatabase.migrate(
      resolve(repositoryRoot, "apps/savia-request/migrations"),
    );
    const smtp = env.SAVIA_SMTP_HOST
      ? nodemailer.createTransport({
          host: env.SAVIA_SMTP_HOST,
          port: Number(env.SAVIA_SMTP_PORT ?? 465),
          secure: Number(env.SAVIA_SMTP_PORT ?? 465) === 465,
          auth: env.SAVIA_SMTP_USERNAME
            ? { user: env.SAVIA_SMTP_USERNAME, pass: env.SAVIA_SMTP_PASSWORD }
            : undefined,
        })
      : undefined;
    if (smtp && !env.SAVIA_SMTP_FROM)
      throw new Error("SAVIA_SMTP_FROM is required with SMTP");
    const auth = createAuthHandler(
      {
        AUTH_DB: authDatabase,
        BETTER_AUTH_URL: config.publicOrigin,
        BETTER_AUTH_SECRET: config.authSecret,
        BETTER_AUTH_BOOTSTRAP_EMAIL: config.bootstrapEmail,
        BETTER_AUTH_BOOTSTRAP_PASSWORD: config.bootstrapPassword,
        SAVIA_API_RESOURCE: config.publicOrigin,
        SAVIA_ADMIN_REDIRECT_URI: `${config.publicOrigin}/auth/callback`,
        SAVIA_SCALAR_REDIRECT_URI: `${config.publicOrigin}/docs`,
      },
      smtp
        ? {
            sendTransactionalEmail: async (email) => {
              await smtp.sendMail({ ...email, from: env.SAVIA_SMTP_FROM });
            },
          }
        : {},
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
        "OPENROUTER_API_KEY",
        "OPENROUTER_MODEL",
        "NANGO_API_KEY",
        "NANGO_BASE_URL",
        "NANGO_CONNECT_URL",
        "NANGO_HUBSPOT_INTEGRATION_ID",
        "NANGO_GOOGLE_DRIVE_INTEGRATION_ID",
        "NANGO_GMAIL_INTEGRATION_ID",
        "NANGO_GOOGLE_CALENDAR_INTEGRATION_ID",
        "NANGO_OUTLOOK_INTEGRATION_ID",
        "NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID",
        "NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID",
        "SQL_BRIDGE_URL",
        "SQL_BRIDGE_SECRET",
      ].flatMap((key) => (env[key] ? [[key, env[key]]] : [])),
    );
    const environment: RuntimeEnvironment = {
      ...optional,
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
    // Initialize authentication before accepting traffic, including bootstrap and OAuth clients.
    const startup = await auth.fetch(
      new Request(`${config.publicOrigin}/api/auth/get-session`),
    );
    if (startup.status >= 500)
      throw new Error(
        `Authentication initialization failed (${startup.status})`,
      );
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
        await scheduled?.catch(() => undefined);
        realtime.close();
        await outbound.close();
        objects.close();
        smtp?.close();
        database.close();
        authDatabase.close();
        requestDatabase.close();
      },
    };
  } catch (error) {
    realtime.close();
    await outbound.close();
    objects.close();
    database.close();
    authDatabase.close();
    requestDatabase.close();
    throw error;
  }
}
