import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotificationRepository } from "@savia/crm-server/notifications/repository";
import { createApp } from "../src/app";
import { AuthenticationError, type Authenticator } from "../src/auth/types";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) =>
        value
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)) {
      await env.DB.exec(statement);
    }
  }
}

async function seedPrincipal(id: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal (
      id, issuer, subject, email, display_name, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      "savia:test",
      id,
      `${id}@savia.test`,
      id,
      1,
      "2026-09-05T00:00:00.000Z",
      "2026-09-05T00:00:00.000Z",
    )
    .run();
}

function authenticator(principalId: string): Authenticator {
  return {
    async authenticate() {
      return {
        principal: {
          id: principalId,
          issuer: "savia:test",
          subject: principalId,
          email: `${principalId}@savia.test`,
          displayName: principalId,
          isActive: true,
          createdAt: "2026-09-05T00:00:00.000Z",
          updatedAt: "2026-09-05T00:00:00.000Z",
        },
        globalRoles: [],
        memberships: [],
      };
    },
  };
}

function appFor(principalId: string) {
  return createApp(env.DB, undefined, undefined, authenticator(principalId));
}

function request(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
) {
  return app.request(path, init, { DB: env.DB } as never);
}

async function seedDelivery(principalId: string, title: string) {
  const repository = new NotificationRepository(env.DB);
  const { id: eventId } = await repository.accept({
    scope: { kind: "account", id: principalId },
    key: `inbox-${principalId}-${title}`,
    actor: { kind: "user", id: "admin" },
    source: { kind: "admin-message", id: "m1" },
    title,
    body: "World",
    audience: { kind: "explicit", principals: [principalId] },
    createdAt: Date.now(),
    expiresAt: null,
  });
  await env.DB.prepare(
    `INSERT INTO notification_deliveries(
      id, event_id, scope_kind, scope_id, recipient_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `delivery-${principalId}-${title}`,
      eventId,
      "account",
      principalId,
      principalId,
      Date.now(),
    )
    .run();
}

describe("notification inbox routes", () => {
  beforeAll(applyMigrations);

  beforeEach(async () => {
    await env.DB.exec(`
      DELETE FROM notification_deliveries;
      DELETE FROM notification_events;
      DELETE FROM identity_principal WHERE id IN ('principal-inbox', 'principal-other');
    `);
    await seedPrincipal("principal-inbox");
    await seedPrincipal("principal-other");
  });

  it("returns an empty page when the principal has no deliveries", async () => {
    const app = appFor("principal-inbox");
    const response = await request(
      app,
      "https://savia.test/api/notifications?filter=all",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { items: [], nextCursor: null, cutoff: "" },
    });
  });

  it("lists account deliveries for the authenticated principal only", async () => {
    await seedDelivery("principal-inbox", "Hello");
    const app = appFor("principal-inbox");
    const response = await request(
      app,
      "https://savia.test/api/notifications?filter=all",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { items: Array<{ title: string }> };
    };
    expect(body.data.items.map((item) => item.title)).toEqual(["Hello"]);

    const other = appFor("principal-other");
    const otherResponse = await request(
      other,
      "https://savia.test/api/notifications?filter=all",
    );
    expect(otherResponse.status).toBe(200);
    await expect(otherResponse.json()).resolves.toEqual({
      data: { items: [], nextCursor: null, cutoff: "" },
    });
  });

  it("rejects unauthenticated inbox reads", async () => {
    const app = createApp(env.DB, undefined, undefined, {
      async authenticate() {
        throw new AuthenticationError(
          "AUTHENTICATION_REQUIRED",
          "Sign in to continue",
        );
      },
    });
    const response = await request(
      app,
      "https://savia.test/api/notifications?filter=all",
    );
    expect(response.status).toBe(401);
  });
});
