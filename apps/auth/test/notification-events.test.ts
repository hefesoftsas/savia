import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import authWorker from "../src/index";
import {
  authNoticeBridgeAuthorized,
  ensureAuthNoticeSchema,
  readAuthNoticeEvents,
  ackAuthNoticeEvents,
} from "../src/notification-events";

const origin = "http://127.0.0.1:8787";

beforeAll(async () => {
  await authWorker.fetch(new Request(`${origin}/api/auth/ok`), env);
  await ensureAuthNoticeSchema(env.AUTH_DB);
  await env.AUTH_DB.exec("DELETE FROM auth_notice_events");
});

afterAll(async () => {
  await env.AUTH_DB.exec("DELETE FROM auth_notice_events").catch(() => undefined);
});

describe("auth notice source events", () => {
  it("captures email verification transitions without secrets", async () => {
    await env.AUTH_DB.prepare(
      `INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt,role,twoFactorEnabled)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
      .bind("u1", "Test", "test@example.test", 0, null, "2026-09-20", "2026-09-20", "user", 0)
      .run();
    await env.AUTH_DB.prepare(`UPDATE "user" SET emailVerified=1 WHERE id=?`)
      .bind("u1")
      .run();
    const events = await readAuthNoticeEvents(env.AUTH_DB, null, 10);
    expect(events).toHaveLength(1);
    expect(events[0].subject).toBe("u1");
    expect(events[0].kind).toBe("email-verified");
    expect(JSON.stringify(events[0])).not.toContain("token");
    expect(await ackAuthNoticeEvents(env.AUTH_DB, [events[0].id])).toBe(1);
    expect(await readAuthNoticeEvents(env.AUTH_DB, null, 10)).toHaveLength(0);
    await env.AUTH_DB.prepare(`DELETE FROM "user" WHERE id=?`).bind("u1").run();
  });

  it("rejects unauthenticated bridge access", async () => {
    const denied = await authWorker.fetch(
      new Request("https://savia-auth.internal/_internal/notification-events/read?limit=10"),
      env,
    );
    expect(denied.status).toBe(403);
    const ackDenied = await authWorker.fetch(
      new Request("https://savia-auth.internal/_internal/notification-events/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["x"] }),
      }),
      env,
    );
    expect(ackDenied.status).toBe(403);
  });

  it("authorizes the bridge only with the configured key", () => {
    const request = (key?: string) =>
      new Request("https://savia-auth.internal/_internal/notification-events/read", {
        headers: key ? { "x-savia-bridge-key": key } : {},
      });
    expect(authNoticeBridgeAuthorized(undefined, request("anything"))).toBe(false);
    expect(authNoticeBridgeAuthorized("secret", request())).toBe(false);
    expect(authNoticeBridgeAuthorized("secret", request("wrong"))).toBe(false);
    expect(authNoticeBridgeAuthorized("secret", request("secret"))).toBe(true);
  });
});
