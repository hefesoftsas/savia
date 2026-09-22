import { z } from "zod";
import type { Hono, Context } from "hono";
import type { Env } from "../context";
import {
  inboxQuerySchema,
  type NoticeScope,
  type NotificationPolicy,
} from "@savia/crm-shared/notifications";
import { fail } from "../context";
import { NotificationRepository } from "./repository";
import { resolveNoticeAction, resolveTaskNotice } from "./actions";
import { adminEventStatus, retryAdminEvent, sendAdminNotice } from "./admin";
import { notificationSettingsRoute } from "./maintenance";

export const notificationRequests = {
  inboxQuery: inboxQuerySchema,
  readBody: z.strictObject({ read: z.boolean() }),
  followBody: z.strictObject({ collection: z.string().min(1).max(200) }),
  readAllBody: z.strictObject({ cursor: z.string().max(2048).optional() }),
  adminSendBody: z.strictObject({
    scope: z.strictObject({
      kind: z.literal("workspace"),
      id: z.string().min(1).max(200),
    }),
    key: z.string().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(4000).default(""),
    audience: z.union([
      z.strictObject({
        kind: z.literal("explicit"),
        principals: z.array(z.string().min(1).max(200)).min(1).max(100),
      }),
      z.strictObject({ kind: z.literal("workspace-members") }),
    ]),
    requireAcknowledgement: z.boolean().default(false),
  }),
};

export interface NotificationRouteOptions {
  policy?: NotificationPolicy;
}

const denyPolicy: NotificationPolicy = {
  async recipients() {
    return { ids: [], nextCursor: null };
  },
  async canReadScope() {
    return false;
  },
  async canReadSource() {
    return false;
  },
  async canSend() {
    return false;
  },
};

function session(c: Context<Env>, options: NotificationRouteOptions) {
  const principalId = c.get("principalId") as string | undefined;
  const tenant = c.get("tenant") as string | undefined;
  if (!principalId || !tenant) return fail("Authentication required.", 401);
  return {
    principalId,
    tenant,
    policy: options.policy ?? denyPolicy,
    repository: new NotificationRepository(c.env.DB),
  };
}

function scopes(
  tenant: string,
  principalId: string,
  only?: string,
): NoticeScope[] {
  if (only === "account") return [{ kind: "account", id: principalId }];
  return [
    { kind: "workspace", id: tenant },
    { kind: "account", id: principalId },
  ];
}

export function registerNotifications(
  app: Hono<Env>,
  options: NotificationRouteOptions = {},
) {
  app.get("/api/notifications", async (c) => {
    const { principalId, tenant, repository } = session(c, options);
    const query = inboxQuerySchema.parse({
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
      filter: c.req.query("filter"),
    });
    c.header("Cache-Control", "no-store");
    return c.json({
      data: await repository.list(
        principalId,
        scopes(tenant, principalId, c.req.query("scope")),
        query,
      ),
    });
  });
  app.get("/api/notifications/count", async (c) => {
    const { principalId, tenant, repository } = session(c, options);
    const filter = c.req.query("filter");
    if (filter !== undefined && !["all", "unread", "pending"].includes(filter))
      return fail("Invalid count filter.", 400);
    c.header("Cache-Control", "no-store");
    return c.json({
      data: {
        count: await repository.count(
          principalId,
          scopes(tenant, principalId, c.req.query("scope")),
          {
            filter:
              (filter as "all" | "unread" | "pending" | undefined) ?? "all",
          },
        ),
      },
    });
  });
  app.post("/api/notifications/read-all", async (c) => {
    const { principalId, tenant, repository } = session(c, options);
    const body = notificationRequests.readAllBody.parse(
      await c.req.json().catch(() => ({})),
    );
    return c.json({
      data: await repository.markAllRead(
        principalId,
        { kind: "workspace", id: tenant },
        body.cursor,
      ),
    });
  });
  app.post("/api/notifications/:id/read", async (c) => {
    const { principalId, tenant, repository } = session(c, options);
    const body = notificationRequests.readBody.parse(
      await c.req.json().catch(() => ({})),
    );
    await repository.markRead(
      principalId,
      { kind: "workspace", id: tenant },
      c.req.param("id"),
      body.read,
    );
    return c.json({ data: { updated: true } });
  });
  app.post("/api/notifications/:id/archive", async (c) => {
    const { principalId, tenant, repository } = session(c, options);
    await repository.archive(
      principalId,
      { kind: "workspace", id: tenant },
      c.req.param("id"),
    );
    return c.json({ data: { updated: true } });
  });
  app.post("/api/notifications/:id/resolve", async (c) => {
    const { principalId, tenant, policy } = session(c, options);
    await resolveTaskNotice(
      c.env.DB,
      policy,
      principalId,
      { kind: "workspace", id: tenant },
      c.req.param("id"),
    );
    return c.json({ data: { resolved: true } });
  });
  app.get("/api/notifications/action/:id", async (c) => {
    const { principalId, tenant, policy } = session(c, options);
    c.header("Cache-Control", "no-store");
    return c.json({
      data: await resolveNoticeAction(
        c.env.DB,
        policy,
        principalId,
        { kind: "workspace", id: tenant },
        c.req.param("id"),
      ),
    });
  });
  app.post("/api/notifications/admin/send", async (c) => {
    const { principalId, tenant, policy } = session(c, options);
    const body = notificationRequests.adminSendBody.parse(
      await c.req.json().catch(() => ({})),
    );
    if (body.scope.id !== tenant)
      return fail("Administrator scope mismatch.", 403);
    return c.json({
      data: await sendAdminNotice(
        c.env.DB,
        policy,
        principalId,
        body.scope,
        body.key,
        {
          title: body.title,
          body: body.body,
          audience: body.audience,
          requireAcknowledgement: body.requireAcknowledgement,
        },
      ),
    });
  });
  app.get("/api/notifications/admin/:eventId/status", async (c) => {
    const { principalId } = session(c, options);
    c.header("Cache-Control", "no-store");
    return c.json({
      data: await adminEventStatus(
        c.env.DB,
        principalId,
        c.req.param("eventId"),
      ),
    });
  });
  app.post("/api/notifications/admin/:eventId/retry", async (c) => {
    const { principalId } = session(c, options);
    return c.json({
      data: await retryAdminEvent(
        c.env.DB,
        principalId,
        c.req.param("eventId"),
      ),
    });
  });
  app.get("/api/notifications/settings", async (c) => {
    const { principalId, tenant, policy } = session(c, options);
    c.header("Cache-Control", "no-store");
    return c.json({
      data: await notificationSettingsRoute(
        c.env.DB,
        principalId,
        tenant,
        await policy.canSend(principalId, { kind: "workspace", id: tenant }),
      ),
    });
  });
  app.post("/api/notifications/settings", async (c) => {
    const { principalId, tenant, policy } = session(c, options);
    const body = await c.req.json().catch(() => ({}));
    return c.json({
      data: await notificationSettingsRoute(
        c.env.DB,
        principalId,
        tenant,
        await policy.canSend(principalId, { kind: "workspace", id: tenant }),
        body,
      ),
    });
  });
  app.get("/api/notifications/follows", async (c) => {
    const { principalId, tenant, repository } = session(c, options);
    c.header("Cache-Control", "no-store");
    return c.json({ data: await repository.follows(principalId, tenant) });
  });
  app.post("/api/notifications/follow", async (c) => {
    const { principalId, tenant, repository } = session(c, options);
    const body = notificationRequests.followBody.parse(
      await c.req.json().catch(() => ({})),
    );
    await repository.follow(principalId, tenant, body.collection);
    return c.json({ data: { following: true } });
  });
  app.delete("/api/notifications/follow/:collection", async (c) => {
    const { principalId, tenant, repository } = session(c, options);
    await repository.unfollow(principalId, tenant, c.req.param("collection"));
    return c.json({ data: { following: false } });
  });
}
