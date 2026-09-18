import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./combined-app";
import { createRealtimeHubClient } from "../src/realtime/hub-client";
import {
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

function migrationStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migrationStatements(migration)) {
      await env.DB.exec(statement);
    }
  }
}

async function seedTenant(id = 101): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO tenants (id, id_slug, name, is_active, created_at, updated_at, kind) VALUES (?, ?, ?, 1, '2026-01-01', '2026-01-01', 'commercial')",
  )
    .bind(id, `realtime-tenant-${id}`, `Realtime Tenant ${id}`)
    .run();
}

function identityUserAdministrator() {
  const accounts = new Map<
    string,
    {
      subject: string;
      email: string;
      displayName: string;
      role: "admin" | "user";
      isBanned: boolean;
      twoFactorEnabled: boolean;
    }
  >();
  return {
    issuer: "savia:better-auth",
    async listUsers() {
      return [...accounts.values()];
    },
    async getUser(subject: string) {
      return {
        subject,
        email: "realtime.user@acme.test",
        displayName: "Realtime User",
        role: "user" as const,
        isBanned: false,
        twoFactorEnabled: false,
      };
    },
    async createUser(input: {
      email: string;
      firstName: string;
      lastName: string;
      platformAdmin: boolean;
    }) {
      const account = {
        subject: "better-auth-realtime-user",
        email: input.email,
        displayName: `${input.firstName} ${input.lastName}`,
        role: input.platformAdmin ? ("admin" as const) : ("user" as const),
        isBanned: false,
        twoFactorEnabled: false,
      };
      accounts.set(account.subject, account);
      return account;
    },
    async updateUser(subject: string) {
      return {
        subject,
        email: "realtime.user@acme.test",
        displayName: "Realtime User",
        role: "user" as const,
        isBanned: false,
        twoFactorEnabled: false,
      };
    },
    async setAccountActive(subject: string) {
      return {
        subject,
        email: "realtime.user@acme.test",
        displayName: "Realtime User",
        role: "user" as const,
        isBanned: false,
        twoFactorEnabled: false,
      };
    },
    async revokeSessions() {},
    async sendPasswordReset() {},
    async deleteUser(subject: string) {
      accounts.delete(subject);
    },
  };
}

function roomStub(room: string) {
  return env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName(room));
}

async function issueTicket(
  stub: DurableObjectStub,
  grant: { principalId: string; topics: string[] },
): Promise<string> {
  const response = await stub.fetch("https://realtime.internal/issue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(grant),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: { ticket: string; expiresAt: string };
  };
  return body.data.ticket;
}

async function connectSocket(stub: DurableObjectStub, ticket: string) {
  const upgrade = await stub.fetch(
    `https://realtime.internal/session?ticket=${encodeURIComponent(ticket)}`,
    { headers: { Upgrade: "websocket" } },
  );
  expect(upgrade.status).toBe(101);
  const socket = upgrade.webSocket;
  expect(socket).toBeDefined();
  const received: Array<Record<string, unknown>> = [];
  // workerd test sockets require accept(); real browsers do not.
  (socket as unknown as { accept?: () => void }).accept?.();
  socket!.addEventListener("message", (event) => {
    received.push(
      event.data === "pong" ? { type: "pong" } : JSON.parse(String(event.data)),
    );
  });
  return { socket: socket!, received };
}

async function waitFor(
  received: Array<Record<string, unknown>>,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const found = received.find(predicate);
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for realtime message, got: ${JSON.stringify(received)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("Realtime hub", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM identity_tenant_membership");
    await env.DB.exec("DELETE FROM identity_global_role");
    await env.DB.exec("DELETE FROM identity_principal");
    await env.DB.exec("DELETE FROM agencies");
    await env.DB.exec("DELETE FROM tenants");
  });

  it("delivers published events only to subscribed sockets", async () => {
    const stub = roomStub("platform");
    const users = await connectSocket(
      stub,
      await issueTicket(stub, { principalId: "p-1", topics: ["users"] }),
    );
    const tenants = await connectSocket(
      stub,
      await issueTicket(stub, { principalId: "p-2", topics: ["tenants"] }),
    );

    await stub.fetch("https://realtime.internal/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: { topic: "users", type: "created", id: "principal-9" },
      }),
    });

    const created = await waitFor(
      users.received,
      (message) => message.type === "created",
    );
    expect(created).toMatchObject({ v: 1, topic: "users", id: "principal-9" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tenants.received.some((message) => message.type === "created")).toBe(
      false,
    );
  });

  it("isolates rooms from each other", async () => {
    const platform = await connectSocket(
      roomStub("platform"),
      await issueTicket(roomStub("platform"), {
        principalId: "p-1",
        topics: ["users"],
      }),
    );
    const tenant = await connectSocket(
      roomStub("tenant:101"),
      await issueTicket(roomStub("tenant:101"), {
        principalId: "p-2",
        topics: ["records"],
      }),
    );

    await roomStub("tenant:101").fetch("https://realtime.internal/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: { topic: "records", type: "updated", collection: "quotes" },
      }),
    });

    await waitFor(tenant.received, (message) => message.type === "updated");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      platform.received.some((message) => message.type === "updated"),
    ).toBe(false);
  });

  it("rejects invalid tickets and enforces single use", async () => {
    const stub = roomStub("platform");
    const bad = await stub.fetch(
      "https://realtime.internal/session?ticket=missing",
      { headers: { Upgrade: "websocket" } },
    );
    expect(bad.status).toBe(401);

    const ticket = await issueTicket(stub, {
      principalId: "p-1",
      topics: ["users"],
    });
    const first = await stub.fetch(
      `https://realtime.internal/session?ticket=${ticket}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(first.status).toBe(101);
    const second = await stub.fetch(
      `https://realtime.internal/session?ticket=${ticket}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(second.status).toBe(401);
  });

  it("auto-responds to pings without invoking the message handler", async () => {
    const stub = roomStub("tenant:8802");
    const ticket = await issueTicket(stub, {
      principalId: "ping-user",
      topics: ["records"],
    });
    const { socket, received } = await connectSocket(stub, ticket);
    socket.send("ping");
    await waitFor(received, (message) => message.type === "pong");
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event.code)),
    );
    socket.send('{"type":"subscribe"}');
    expect(await closed).toBe(1008);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(state.getWebSocketAutoResponse()?.request).toBe("ping");
      expect(state.getWebSocketAutoResponse()?.response).toBe("pong");
    });
  });

  it("bounds expiry cleanup and leaves valid tickets usable", async () => {
    const stub = roomStub("tenant:8803");
    const ticket = await issueTicket(stub, {
      principalId: "cleanup-user",
      topics: ["records"],
    });
    await runInDurableObject(stub, async (_instance, state) => {
      for (let i = 0; i < 200; i++)
        state.storage.sql.exec(
          "INSERT INTO realtime_tickets VALUES (?, ?, ?, ?)",
          `expired-${i}`,
          "old",
          '["records"]',
          0,
        );
    });
    await issueTicket(stub, {
      principalId: "cleanup-user",
      topics: ["records"],
    });
    await runInDurableObject(stub, async (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT count(*) AS count FROM realtime_tickets WHERE expires = 0",
          )
          .one().count,
      ).toBe(72);
    });
    (await connectSocket(stub, ticket)).socket.close();
  });

  it("propagates capacity throttling through the hub client", async () => {
    const hub = createRealtimeHubClient(env.REALTIME_HUB);
    for (let i = 0; i < 8; i++)
      await hub.issue("tenant:8804", {
        principalId: "pending",
        topics: ["records"],
      });
    await expect(
      hub.issue("tenant:8804", { principalId: "pending", topics: ["records"] }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("caps simultaneous connections per principal", async () => {
    const stub = roomStub("tenant:8801");
    const sockets: WebSocket[] = [];
    for (let i = 0; i < 8; i++) {
      const ticket = await issueTicket(stub, {
        principalId: "limited",
        topics: ["records"],
      });
      sockets.push((await connectSocket(stub, ticket)).socket);
    }
    const response = await stub.fetch("https://realtime.internal/issue", {
      method: "POST",
      body: JSON.stringify({ principalId: "limited", topics: ["records"] }),
    });
    expect(response.status).toBe(429);
    for (const socket of sockets) socket.close();
  });

  it("issues tickets by role and publishes user mutations", async () => {
    await seedTenant();
    const hub = createRealtimeHubClient(env.REALTIME_HUB);
    const administratorApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
      identityUserAdministrator(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      hub,
    );
    const memberApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      agencyMemberAuthenticator(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      hub,
    );

    const forbidden = await memberApp.request("/v1/realtime/ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics: ["users"] }),
    });
    expect(forbidden.status).toBe(403);

    const ticketed = await administratorApp.request("/v1/realtime/ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics: ["users"] }),
    });
    expect(ticketed.status).toBe(201);
    const ticketBody = (await ticketed.json()) as {
      data: { room: string; ticket: string; topics: string[] };
    };
    expect(ticketBody.data).toMatchObject({
      room: "platform",
      topics: ["users"],
    });

    const viewing = await connectSocket(
      roomStub("platform"),
      ticketBody.data.ticket,
    );

    const provisioned = await administratorApp.request("/v1/identity/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "realtime.user@acme.test",
        firstName: "Realtime",
        lastName: "User",
        platformAdmin: false,
        membership: { agencyId: 101, role: "operator" },
      }),
    });
    expect(provisioned.status).toBe(201);

    const created = await waitFor(
      viewing.received,
      (message) => message.type === "created",
    );
    expect(created).toMatchObject({ topic: "users" });
    expect(typeof created.id).toBe("string");
  });

  it("authorizes record topics by tenant membership", async () => {
    const hub = createRealtimeHubClient(env.REALTIME_HUB);
    const memberApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      agencyMemberAuthenticator(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      hub,
    );

    const foreignSocket = await memberApp.request(
      `/v1/realtime/subscribe?room=tenant:999&ticket=${crypto.randomUUID()}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(foreignSocket.status).toBe(403);

    const missingTenant = await memberApp.request("/v1/realtime/ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics: ["records"] }),
    });
    expect(missingTenant.status).toBe(400);

    const foreign = await memberApp.request("/v1/realtime/ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics: ["records"], tenantId: 999 }),
    });
    expect(foreign.status).toBe(403);

    const allowed = await memberApp.request("/v1/realtime/ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics: ["records"], tenantId: 101 }),
    });
    expect(allowed.status).toBe(201);
    expect(await allowed.json()).toMatchObject({
      data: { room: "tenant:101", topics: ["records"] },
    });
    for (let i = 0; i < 7; i++) {
      const response = await memberApp.request("/v1/realtime/ticket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topics: ["records"], tenantId: 101 }),
      });
      expect(response.status).toBe(201);
    }
    const capacity = await memberApp.request("/v1/realtime/ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics: ["records"], tenantId: 101 }),
    });
    expect(capacity.status).toBe(429);
    expect(capacity.headers.get("Retry-After")).toBe("60");
    expect(await capacity.json()).toMatchObject({
      error: { code: "REALTIME_LIMIT" },
    });

    for (let i = 0; i < 30; i++) {
      const response = await memberApp.request(
        `/v1/realtime/subscribe?room=tenant:999&ticket=${crypto.randomUUID()}`,
        { headers: { Upgrade: "websocket" } },
        env,
      );
      expect(response.status).toBe(403);
    }
    const throttled = await memberApp.request(
      `/v1/realtime/subscribe?room=tenant:999&ticket=${crypto.randomUUID()}`,
      { headers: { Upgrade: "websocket" } },
      env,
    );
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBe("60");
  });
});
