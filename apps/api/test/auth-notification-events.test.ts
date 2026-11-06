import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { upsertPrincipal } from "../src/auth/identity-repository";
import { importAuthNoticeEvents } from "../src/auth/notification-events";

const migrations = Object.entries(
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

let principalId = "";

beforeAll(async () => {
  for (const sql of migrations) await apply(sql);
  principalId = (
    await upsertPrincipal(env.DB, {
      issuer: "savia:better-auth",
      subject: "auth-user-1",
      email: "auth1@example.test",
      displayName: "Auth One",
    })
  ).id;
});

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM notification_deliveries; DELETE FROM notification_events;",
  );
});

function fakeAuth(events: unknown[], acked: { acknowledged: number } = { acknowledged: 0 }) {
  return {
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/read")) return Response.json({ events });
      return Response.json(acked);
    },
  };
}

it("imports mapped auth events once and skips unknown principals", async () => {
  const service = fakeAuth([
    {
      id: "auth_auth-user-1_email_x",
      subject: "auth-user-1",
      kind: "email-verified",
      createdAt: 1000,
      expiresAt: null,
      requestId: null,
    },
    {
      id: "auth_ghost_email_x",
      subject: "ghost",
      kind: "email-verified",
      createdAt: 1000,
      expiresAt: null,
      requestId: null,
    },
  ]);
  const first = await importAuthNoticeEvents(service, env.DB, {});
  expect(first.accepted).toBe(1);
  const stored = (
    await env.DB.prepare("SELECT payload FROM notification_events").all<{ payload: string }>()
  ).results;
  expect(stored).toHaveLength(1);
  const parsed = JSON.parse(stored[0].payload) as { title: string; scope: { id: string } };
  expect(parsed.title).toBe("Email verified");
  expect(parsed.scope.id).toBe(principalId);
  const second = await importAuthNoticeEvents(service, env.DB, {});
  expect(second.accepted).toBe(0);
});

it("rejects a forbidden bridge with status context", async () => {
  const service = {
    fetch: async () => new Response("forbidden", { status: 403 }),
  };
  await expect(importAuthNoticeEvents(service, env.DB, {})).rejects.toMatchObject({
    status: 403,
  });
});
