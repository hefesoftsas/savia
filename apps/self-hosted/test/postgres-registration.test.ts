import { registerPublicTenantRegistrationRoutes } from "../../api/src/tenant-registration/public-routes";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { createAuthHandler } from "../../auth/src/index";
import { openPostgresDatabase } from "../src/postgres/database";
import { migratePostgres } from "../src/postgres/migrations";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";
import { createApiShell } from "../../api/src/api-shell";
import { registerEmailRegistrationRoutes } from "../../api/src/tenant-registration/provisioning";
import type { SMTPEmail } from "../../auth/src/smtp";

it.skipIf(!postgresTestUrl)(
  "completes native PostgreSQL verified registration with Viewer access",
  async () => {
    await withPostgresFixture(async (core, url) => {
      await migratePostgres({
        connectionString: url,
        schema: "savia_core",
        directory: resolve("../../packages/db/postgres"),
        seed: true,
      });
      const db = openPostgresDatabase({
        connectionString: url,
        schema: "savia_auth",
        maxConnections: 3,
      });
      try {
        const origin = "https://savia-native.test";
        const tenantId = 381000;
        await core
          .prepare(
            "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(?,?,?,'commercial',1,?,?)",
          )
          .bind(tenantId, "native", "Native tenant", "now", "now")
          .run();
        let api: ReturnType<typeof createApiShell>;
        let mail: SMTPEmail | undefined;
        const auth = createAuthHandler(
          {
            AUTH_DB: db,
            BETTER_AUTH_BOOTSTRAP_EMAIL: "bootstrap-native@example.test",
            BETTER_AUTH_BOOTSTRAP_PASSWORD: "Native-bootstrap-password-1234",
            BETTER_AUTH_URL: origin,
            BETTER_AUTH_SECRET: "native-registration-test-secret",
            SAVIA_API_RESOURCE: origin,
            SAVIA_INTERNAL_BRIDGE_KEY: "native-registration",
            SAVIA_IDENTITY: { fetch: async (request) => api.fetch(request) },
          },
          {
            database: db.pool,
            sendTransactionalEmail: async (email) => {
              mail = email;
            },
          },
        );
        api = createApiShell(core, undefined, auth);
        registerEmailRegistrationRoutes(api, core, auth, "native-registration");
        registerPublicTenantRegistrationRoutes(
          api,
          core,
          auth,
          "native-registration",
          {
            publicOrigin: origin,
            captchaProvider: "altcha",
            altchaSecret: "native-altcha-registration-secret-32-bytes",
            rateLimiter: { limit: async () => ({ success: true }) },
            disableCaptcha: true,
          },
        );
        const headers = {
          "content-type": "application/json",
          "x-savia-bridge-key": "native-registration",
        };
        const saved = await auth.fetch(
          new Request(`${origin}/_internal/tenant-registration/${tenantId}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              allowEmailRegistration: true,
              captchaMode: "inherit",
              captchaReady: true,
            }),
          }),
        );
        expect(saved.status, await saved.clone().text()).toBe(200);
        const settings = (await saved.json()) as { revision: string };
        const publicConfig = await api.fetch(
          new Request(
            "https://native.savia-native.test/v1/public/registration",
          ),
        );
        expect(publicConfig.status, await publicConfig.clone().text()).toBe(
          200,
        );
        expect(await publicConfig.json()).toMatchObject({
          tenantId,
          captchaProvider: "altcha",
        });
        const challenge = await api.fetch(
          new Request(
            "https://native.savia-native.test/v1/public/registration/challenge",
          ),
        );
        expect(challenge.status).toBe(200);
        expect(await challenge.json()).toMatchObject({
          parameters: {
            data: { action: "tenant_signup", tenantId: String(tenantId) },
          },
        });
        const email = "new-native@example.test";
        const body = {
          attemptId: crypto.randomUUID(),
          tenantId,
          email,
          name: "Native member",
          password: "Native-password-12345",
          revision: settings.revision,
          origin: "https://native.savia-native.test",
        };
        const started = await auth.fetch(
          new Request(`${origin}/_internal/email-registration/start`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          }),
        );
        expect(started.status, await started.clone().text()).toBe(200);
        expect(mail).toBeDefined();
        const verificationUrl = new URL(
          mail!.text.match(/https?:\/\/[^\s]+token=[^\s]+/)![0],
        );
        verificationUrl.searchParams.delete("callbackURL");
        expect((await auth.fetch(new Request(verificationUrl))).ok).toBe(true);
        const signedIn = await auth.fetch(
          new Request(`${origin}/api/auth/sign-in/email`, {
            method: "POST",
            headers: { "content-type": "application/json", origin },
            body: JSON.stringify({ email, password: body.password }),
          }),
        );
        expect(signedIn.status, await signedIn.clone().text()).toBe(200);
        expect(signedIn.headers.get("set-cookie")).toContain(
          "savia.session_token",
        );
        const membership = await core
          .prepare(
            "SELECT role,is_active FROM identity_tenant_membership WHERE tenant_id=?",
          )
          .bind(tenantId)
          .first<{ role: string; is_active: number }>();
        expect(membership).toMatchObject({ role: "viewer", is_active: 1 });
      } finally {
        await db.close();
      }
    });
  },
  120_000,
);
