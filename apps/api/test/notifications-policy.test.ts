import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  grantMembership,
  setPlatformAdministrator,
  upsertPrincipal,
} from "../src/auth/identity-repository";
import { createNotificationPolicy } from "../src/notifications";

const dbMigrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

async function apply(sql: string) {
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((entry) =>
      entry
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)) {
    await env.DB.exec(statement);
  }
}

let admin = "";
let member = "";
let outsider = "";

beforeAll(async () => {
  for (const sql of dbMigrations) await apply(sql);
  await env.DB.exec(
    "INSERT OR IGNORE INTO tenants (id, id_slug, name, is_active, created_at, updated_at) VALUES (9201, 'notice-tenant', 'Notice Tenant', 1, '2026-09-20', '2026-09-20')",
  );
  const make = async (email: string) =>
    (
      await upsertPrincipal(env.DB, {
        issuer: "test",
        subject: crypto.randomUUID(),
        email,
        displayName: email,
      })
    ).id;
  admin = await make("notice-admin@example.test");
  member = await make("notice-member@example.test");
  outsider = await make("notice-outsider@example.test");
  await setPlatformAdministrator(env.DB, admin, true);
  await grantMembership(env.DB, member, 9201, "viewer");
});

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM notification_subscriptions; DELETE FROM notification_deliveries; DELETE FROM notification_events;",
  );
});

const workspace = { kind: "workspace", id: "agency:9201" } as const;

describe("notification policy", () => {
  it("resolves explicit recipients through the dispatcher helper", async () => {
    const policy = createNotificationPolicy(env.DB);
    const event = {
      scope: workspace,
      key: "explicit",
      actor: { kind: "user", id: admin },
      source: { kind: "admin-message", id: "m1" },
      title: "Hello",
      body: "",
      audience: { kind: "explicit", principals: [member, outsider] },
      createdAt: 1000,
      expiresAt: null,
    } as const;
    // Explicit audiences are returned in sorted order for stable pagination.
    expect((await policy.recipients(event, null, 10)).ids).toEqual(
      [member, outsider].sort(),
    );
  });

  it("resolves workspace members and collection followers", async () => {
    const policy = createNotificationPolicy(env.DB);
    await env.DB.prepare(
      "INSERT INTO notification_subscriptions(workspace_id,principal_id,collection,created_at) VALUES (?,?,?,?)",
    )
      .bind(workspace.id, member, "requests", 1000)
      .run();
    const members = await policy.recipients(
      {
        scope: workspace,
        key: "members",
        actor: { kind: "system", id: null },
        source: { kind: "admin-message", id: "m2" },
        title: "Hi",
        body: "",
        audience: { kind: "workspace-members" },
        createdAt: 1000,
        expiresAt: null,
      },
      null,
      10,
    );
    expect(members.ids).toContain(member);
    expect(members.ids).not.toContain(outsider);
    const followers = await policy.recipients(
      {
        scope: workspace,
        key: "followers",
        actor: { kind: "system", id: null },
        source: { kind: "record", collection: "requests", id: "r1", operation: "updated" },
        title: "Changed",
        body: "",
        audience: { kind: "collection-followers", collection: "requests" },
        createdAt: 1000,
        expiresAt: null,
      },
      null,
      10,
    );
    expect(followers.ids).toEqual([member]);
  });

  it("scopes reads and sends to membership and fails closed", async () => {
    const policy = createNotificationPolicy(env.DB);
    expect(await policy.canReadScope(member, workspace)).toBe(true);
    expect(await policy.canReadScope(outsider, workspace)).toBe(false);
    expect(await policy.canSend(admin, workspace)).toBe(true);
    expect(await policy.canSend(member, workspace)).toBe(false);
    expect(await policy.canSend(admin, { kind: "account", id: admin })).toBe(false);
    expect(
      await policy.canReadSource(member, workspace, {
        kind: "record",
        collection: "missing-collection",
        id: "x",
        operation: "updated",
      }),
    ).toBe(false);
  });
});
