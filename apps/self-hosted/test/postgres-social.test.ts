import { expect, it } from "vitest";
import { createAuthHandler, createBetterAuth } from "../../auth/src/index";
import { validateSocialIdentity } from "../../auth/src/social-sign-in";
import { openPostgresDatabase } from "../src/postgres/database";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";

it.skipIf(!postgresTestUrl)(
  "persists tenant social settings and shares activation state with SAML on native PostgreSQL",
  async () => {
    await withPostgresFixture(async (_core, url) => {
      const authDb = openPostgresDatabase({
        connectionString: url,
        schema: "savia_auth",
        maxConnections: 4,
      });
      try {
        const origin = "http://localhost:8080";
        const bridgeKey = "postgres-social-test-bridge-key";
        const tenantId = 771_000 + Math.floor(Math.random() * 100_000);
        const email = `postgres-social-${crypto.randomUUID()}@example.test`;
        const microsoftTenantId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        const environment = {
          AUTH_DB: authDb,
          BETTER_AUTH_URL: origin,
          BETTER_AUTH_SECRET: "postgres-social-test-secret-".repeat(3),
          BETTER_AUTH_BOOTSTRAP_EMAIL: "postgres-social-admin@example.test",
          BETTER_AUTH_BOOTSTRAP_PASSWORD: "Postgres-Social-Admin-Password-123!",
          SAVIA_API_RESOURCE: origin,
          SAVIA_ADMIN_REDIRECT_URI: `${origin}/auth/callback`,
          SAVIA_SCALAR_REDIRECT_URI: `${origin}/docs`,
          SAVIA_INTERNAL_BRIDGE_KEY: bridgeKey,
          SAVIA_GOOGLE_CLIENT_ID: "synthetic-google-client-id",
          SAVIA_GOOGLE_CLIENT_SECRET: "synthetic-google-client-secret",
          SAVIA_MICROSOFT_CLIENT_ID: "synthetic-microsoft-client-id",
          SAVIA_MICROSOFT_CLIENT_SECRET: "synthetic-microsoft-client-secret",
        };
        const handler = createAuthHandler(environment, {
          database: authDb.pool,
        });
        const call = (path: string, method = "GET", body?: unknown) =>
          handler.fetch(
            new Request(origin + path, {
              method,
              headers: {
                origin,
                "content-type": "application/json",
                "x-savia-bridge-key": bridgeKey,
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            }),
          );

        const created = await call("/_internal/users", "POST", {
          name: "PostgreSQL Social Member",
          email,
          password: "Postgres-Social-Member-Password-123!",
          emailVerified: true,
          tenantId,
        });
        expect(created.status, await created.clone().text()).toBe(201);

        const auth = createBetterAuth(environment);
        const context = await auth.$context;
        const adapter = context.adapter;
        const local = await adapter.findOne<{ id: string; email: string }>({
          model: "user",
          where: [{ field: "email", value: email }],
        });
        expect(local).toMatchObject({ email });

        const settingsPath = `/_internal/tenant-social/${tenantId}`;
        const activityPath = `/_internal/tenant-sso/${tenantId}/activity`;
        const deactivateBeforeSocialSetup = await call(activityPath, "PATCH", {
          active: false,
        });
        expect(
          deactivateBeforeSocialSetup.status,
          await deactivateBeforeSocialSetup.clone().text(),
        ).toBe(204);
        expect(
          await authDb
            .prepare(
              'SELECT "active" FROM "tenantAuthState" WHERE "tenantId"=?',
            )
            .bind(tenantId)
            .first("active"),
        ).toBe(false);

        const initial = await call(settingsPath);
        expect(initial.status).toBe(200);
        expect(initial.headers.get("cache-control")).toBe("no-store");
        expect(await initial.json()).toMatchObject({
          configured: false,
          googleAvailable: true,
          microsoftAvailable: true,
        });
        const reactivateBeforeSocialSetup = await call(activityPath, "PATCH", {
          active: true,
        });
        expect(
          reactivateBeforeSocialSetup.status,
          await reactivateBeforeSocialSetup.clone().text(),
        ).toBe(204);
        expect(
          await authDb
            .prepare(
              'SELECT "active" FROM "tenantAuthState" WHERE "tenantId"=?',
            )
            .bind(tenantId)
            .first("active"),
        ).toBe(true);

        const settings = {
          googleEnabled: true,
          microsoftEnabled: true,
          microsoftTenantId,
        };
        const saved = await call(settingsPath, "PUT", settings);
        expect(saved.status, await saved.clone().text()).toBe(200);
        const savedBody = await saved.json();
        expect(savedBody).toMatchObject({
          configured: true,
          ...settings,
          googleAvailable: true,
          microsoftAvailable: true,
        });
        expect(JSON.stringify(savedBody)).not.toContain(
          "synthetic-google-client-secret",
        );
        expect(JSON.stringify(savedBody)).not.toContain(
          "synthetic-microsoft-client-secret",
        );

        const identityContext = { ...context };
        const endpoint = {
          context: identityContext,
          path: "/callback/google",
          params: { id: "google" },
        };
        const identity = (
          provider: string,
          profile: Record<string, unknown> = {},
        ) => ({
          user: { email, emailVerified: true },
          source: {
            action: "link-account" as const,
            method: "oauth",
            oauth: { providerId: provider, profile },
          },
        });
        expect(
          await validateSocialIdentity(identity("google"), endpoint as never),
        ).toBeUndefined();
        expect(
          await validateSocialIdentity(
            identity("microsoft", { tid: microsoftTenantId }),
            { ...endpoint, context: { ...context } } as never,
          ),
        ).toBeUndefined();
        expect(
          await validateSocialIdentity(
            identity("microsoft", {
              tid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            }),
            { ...endpoint, context: { ...context } } as never,
          ),
        ).toMatchObject({ error: "social_sign_in_denied" });

        const state = () =>
          authDb
            .prepare(
              'SELECT "active", "revision" FROM "tenantSocialSettings" WHERE "tenantId"=?',
            )
            .bind(tenantId)
            .first<{ active: boolean; revision: string }>();
        const beforeActivity = await state();
        expect(beforeActivity?.active).toBe(true);

        const deactivate = await call(activityPath, "PATCH", { active: false });
        expect(deactivate.status, await deactivate.clone().text()).toBe(204);
        const inactive = await state();
        expect(inactive?.active).toBe(false);
        expect(inactive?.revision).not.toBe(beforeActivity?.revision);
        expect(
          await validateSocialIdentity(identity("google"), {
            ...endpoint,
            context: { ...context },
          } as never),
        ).toMatchObject({ error: "social_sign_in_denied" });

        const reactivate = await call(activityPath, "PATCH", { active: true });
        expect(reactivate.status, await reactivate.clone().text()).toBe(204);
        const active = await state();
        expect(active?.active).toBe(true);
        expect(active?.revision).not.toBe(inactive?.revision);
        expect(
          await validateSocialIdentity(identity("google"), {
            ...endpoint,
            context: { ...context },
          } as never),
        ).toBeUndefined();

        const removed = await call(settingsPath, "DELETE");
        expect(removed.status, await removed.clone().text()).toBe(200);
        expect(await removed.json()).toMatchObject({
          configured: false,
          googleEnabled: false,
          microsoftEnabled: false,
          microsoftTenantId: "",
          googleAvailable: true,
          microsoftAvailable: true,
        });
        expect(await state()).toBeNull();
      } finally {
        await authDb.close();
      }
    });
  },
  180_000,
);
