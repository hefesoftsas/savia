import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppActor, Authenticator } from "../src/auth/types";
import { authenticationMiddleware } from "../src/auth/middleware";
import type {
  AssistantChatRequest,
  AssistantService,
} from "../src/assistant/contracts";
import { registerAssistantRoutes } from "../src/assistant/routes";
import { AssistantThreadRepository } from "../src/assistant/threads";
import { createCompanionAssistantContextLoader } from "../src/companion/routes";
import { CompanionRecordings } from "../src/companion/recordings";
import { CompanionSessions } from "../src/companion/sessions";
import { createTestApp } from "./test-app";
import { opusFixtureBase64 } from "./fixtures/companion-tone";

// @ts-expect-error Vitest transforms this Vite-specific import.meta API.
const migrationFiles = import.meta.glob<string>(
  "../../../packages/db/migrations/*.sql",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);
const migrationSqls = (Object.entries(migrationFiles) as [string, string][])
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

function auth(principalId: string): Authenticator {
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

function assistantRouteApp(
  principalId: string,
  service: AssistantService,
  loadThreadContext: NonNullable<
    Parameters<typeof registerAssistantRoutes>[2]
  >["loadThreadContext"],
) {
  const app = new OpenAPIHono();
  app.use("*", authenticationMiddleware(env.DB, auth(principalId)));
  registerAssistantRoutes(app, service, { db: env.DB, loadThreadContext });
  return app;
}

function contextLoader(tenantId: number | null = 101) {
  return async (
    _actor: AppActor,
    _request: Request,
    stored: { kind: "recording" | "session"; id: string; title: string },
  ) => ({
    kind: stored.kind,
    title: stored.title,
    content: "server-resolved transcript",
    tenantId,
  });
}

async function seedPrincipal(id: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal
     (id, issuer, subject, email, display_name, is_active, created_at, updated_at)
     VALUES (?, 'savia:test', ?, ?, ?, 1, ?, ?)`,
  )
    .bind(
      id,
      id,
      `${id}@savia.test`,
      id,
      "2026-09-05T00:00:00.000Z",
      "2026-09-05T00:00:00.000Z",
    )
    .run();
}

const firstThread = "d3aef08a-84e9-4e0e-a36e-0ee9f6e40c20";
const secondThread = "5f34b800-93e0-43e1-9b18-48f3863471d1";
const recordingId = "4568e9c8-4018-4bc8-a82d-74edba8164f2";
const messages = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "Review this" }] },
];

function companionActor(
  id: string,
  credential: AppActor["credential"] = { kind: "interactive" },
): AppActor {
  return {
    principal: {
      id,
      issuer: "savia:test",
      subject: id,
      email: `${id}@savia.test`,
      displayName: id,
      isActive: true,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
    credential,
    globalRoles: [],
    memberships: [
      {
        id: `membership-${id}`,
        principalId: id,
        agencyId: 101,
        tenantId: 101,
        tenantName: "Workspace A",
        tenantSlug: "workspace-a",
        role: "viewer",
        isActive: true,
        createdAt: "2026-09-05T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
      },
      {
        id: `membership-${id}-b`,
        principalId: id,
        agencyId: 202,
        tenantId: 202,
        tenantName: "Workspace B",
        tenantSlug: "workspace-b",
        role: "viewer",
        isActive: true,
        createdAt: "2026-09-05T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
      },
    ],
  };
}

describe("assistant conversation persistence", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec(
      `DELETE FROM assistant_threads;
       DELETE FROM identity_principal WHERE id IN ('thread-user-a', 'thread-user-b');`,
    );
    await seedPrincipal("thread-user-a");
    await seedPrincipal("thread-user-b");
  });

  it("reconstructs the full thread on another request and finds recording threads beyond the list window", async () => {
    const stubService: AssistantService = {
      chat: async () => new Response(),
      confirmAction: async () => ({ state: "unavailable" }),
      cancelAction: async () => ({ state: "unavailable" }),
    };
    const app = assistantRouteApp(
      "thread-user-a",
      stubService,
      contextLoader(),
    );
    const saved = await app.request(`/api/assistant/threads/${firstThread}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Recording review",
        messages,
        context: {
          kind: "recording",
          id: recordingId,
          title: "Call with Maya",
        },
        expectedRevision: 0,
      }),
    });
    expect(saved.status).toBe(200);
    const body = await saved.json<any>();
    expect(body).toMatchObject({
      id: firstThread,
      userId: "thread-user-a",
      revision: 1,
      context: {
        kind: "recording",
        id: recordingId,
        title: "Call with Maya",
        tenantId: 101,
      },
      messages,
    });

    const freshApp = assistantRouteApp(
      "thread-user-a",
      stubService,
      contextLoader(202),
    );
    const loaded = await freshApp.request(
      `/api/assistant/threads/${firstThread}`,
    );
    expect(await loaded.json()).toEqual(body);
    const sourceScopedApp = assistantRouteApp(
      "thread-user-a",
      stubService,
      contextLoader(101),
    );
    const filtered = await sourceScopedApp.request(
      `/api/assistant/threads?contextKind=recording&contextId=${recordingId}`,
    );
    const filteredBody = await filtered.json<any>();
    expect(filteredBody).toMatchObject({
      threads: [
        {
          id: firstThread,
          userId: "thread-user-a",
          title: "Recording review",
          revision: 1,
          context: { tenantId: 101 },
          messageCount: null,
          preview: "",
        },
      ],
    });
    expect(filteredBody.threads[0]).not.toHaveProperty("messages");
    const summaries = await sourceScopedApp.request("/api/assistant/threads");
    const summaryBody = await summaries.json<any>();
    expect(summaryBody.threads).toMatchObject([
      {
        id: firstThread,
        title: "Recording review",
        revision: 1,
        context: { tenantId: 101 },
        messageCount: null,
        preview: "",
      },
    ]);
    expect(summaryBody.threads[0]).not.toHaveProperty("messages");
  });

  it("keeps threads private and prevents foreign reads, updates, and deletes", async () => {
    const owner = createTestApp({ auth: auth("thread-user-a") });
    const stranger = createTestApp({ auth: auth("thread-user-b") });
    await owner.request(`/api/assistant/threads/${firstThread}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Private", messages, expectedRevision: 0 }),
    });

    expect(
      (await stranger.request(`/api/assistant/threads/${firstThread}`)).status,
    ).toBe(404);
    expect(
      await (await stranger.request("/api/assistant/threads")).json(),
    ).toEqual({ threads: [] });
    const update = await stranger.request(
      `/api/assistant/threads/${firstThread}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Takeover",
          messages,
          expectedRevision: 1,
        }),
      },
    );
    expect(update.status).toBe(409);
    const remove = await stranger.request(
      `/api/assistant/threads/${firstThread}?expectedRevision=1`,
      { method: "DELETE" },
    );
    expect(remove.status).toBe(409);
    expect(
      (await owner.request(`/api/assistant/threads/${firstThread}`)).status,
    ).toBe(200);
  });

  it("uses revision compare-and-swap for updates and deletion", async () => {
    const app = createTestApp({ auth: auth("thread-user-a") });
    const create = await app.request(`/api/assistant/threads/${firstThread}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "First", messages, expectedRevision: 0 }),
    });
    expect((await create.json<any>()).revision).toBe(1);
    const update = await app.request(`/api/assistant/threads/${firstThread}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Updated", messages, expectedRevision: 1 }),
    });
    expect((await update.json<any>()).revision).toBe(2);
    const stale = await app.request(`/api/assistant/threads/${firstThread}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Lost update",
        messages,
        expectedRevision: 1,
      }),
    });
    expect(stale.status).toBe(409);
    expect(
      (
        await app.request(
          `/api/assistant/threads/${firstThread}?expectedRevision=1`,
          { method: "DELETE" },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(
          `/api/assistant/threads/${firstThread}?expectedRevision=2`,
          { method: "DELETE" },
        )
      ).status,
    ).toBe(204);
    expect(
      (await app.request(`/api/assistant/threads/${firstThread}`)).status,
    ).toBe(404);
  });

  it("keeps an attached recording context bound to its original source", async () => {
    const service: AssistantService = {
      chat: async () => new Response(),
      confirmAction: async () => ({ state: "unavailable" }),
      cancelAction: async () => ({ state: "unavailable" }),
    };
    const app = assistantRouteApp("thread-user-a", service, contextLoader());
    const create = await app.request(`/api/assistant/threads/${firstThread}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Recording",
        messages,
        context: { kind: "recording", id: recordingId, title: "Call" },
        expectedRevision: 0,
      }),
    });
    expect(create.status).toBe(200);
    const update = await app.request(`/api/assistant/threads/${firstThread}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Call notes",
        messages,
        expectedRevision: 1,
      }),
    });
    expect(await update.json()).toMatchObject({
      revision: 2,
      context: { kind: "recording", id: recordingId, title: "Call" },
    });
    const retarget = await app.request(
      `/api/assistant/threads/${firstThread}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Other recording",
          messages,
          context: {
            kind: "recording",
            id: "d6c908d1-af38-49bf-8837-fec1b2d47fa2",
            title: "Other call",
          },
          expectedRevision: 2,
        }),
      },
    );
    expect(retarget.status).toBe(409);
  });

  it("does not bind a legacy null-tenant context to the current workspace on update", async () => {
    const service: AssistantService = {
      chat: async () => new Response(),
      confirmAction: async () => ({ state: "unavailable" }),
      cancelAction: async () => ({ state: "unavailable" }),
    };
    const app = assistantRouteApp("thread-user-a", service, contextLoader(101));
    const created = await app.request(`/api/assistant/threads/${firstThread}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Legacy recording",
        messages,
        context: { kind: "recording", id: recordingId, title: "Call" },
        expectedRevision: 0,
      }),
    });
    expect(created.status).toBe(200);
    await env.DB.prepare(
      "UPDATE assistant_threads SET context_tenant_id = NULL WHERE id = ?",
    )
      .bind(firstThread)
      .run();

    const updated = await app.request(`/api/assistant/threads/${firstThread}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Legacy recording",
        messages,
        context: { kind: "recording", id: recordingId, title: "Call" },
        expectedRevision: 1,
      }),
    });
    expect(updated.status).toBe(409);
    expect(
      await new AssistantThreadRepository(env.DB).get(
        "thread-user-a",
        firstThread,
      ),
    ).toMatchObject({
      revision: 1,
      context: { tenantId: null },
    });
  });

  it("keeps the same session id isolated by its server-resolved workspace", async () => {
    const service: AssistantService = {
      chat: async () => new Response(),
      confirmAction: async () => ({ state: "unavailable" }),
      cancelAction: async () => ({ state: "unavailable" }),
    };
    const sourceId = "7e9e4702-11e2-43a0-a665-7939c7b923c5";
    const workspaceA = assistantRouteApp(
      "thread-user-a",
      service,
      contextLoader(101),
    );
    const workspaceB = assistantRouteApp(
      "thread-user-a",
      service,
      contextLoader(202),
    );
    const save = (app: OpenAPIHono, id: string) =>
      app.request(`/api/assistant/threads/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Session review",
          messages,
          context: { kind: "session", id: sourceId, title: "Session" },
          expectedRevision: 0,
        }),
      });

    expect((await save(workspaceA, firstThread)).status).toBe(200);
    expect((await save(workspaceB, secondThread)).status).toBe(200);
    const rowsA = await workspaceA.request(
      `/api/assistant/threads?contextKind=session&contextId=${sourceId}`,
    );
    const rowsB = await workspaceB.request(
      `/api/assistant/threads?contextKind=session&contextId=${sourceId}`,
    );
    expect(await rowsA.json()).toMatchObject({
      threads: [{ id: firstThread, context: { tenantId: 101 } }],
    });
    expect(await rowsB.json()).toMatchObject({
      threads: [{ id: secondThread, context: { tenantId: 202 } }],
    });
  });

  it("loads recording context only through the owner's current Companion tenant scope", async () => {
    const ownerId = "context-owner";
    const recording = new CompanionRecordings(env.DOCUMENTS);
    const id = crypto.randomUUID();
    const access = { ownerId, tenantId: 101, requireTenant: true };
    const context = { kind: "recording" as const, id, title: "Workspace call" };
    const loader = createCompanionAssistantContextLoader({
      enabled: true,
      storage: env.DOCUMENTS,
      configuration: {
        effectiveConfigurationFor: async () => ({
          apiKey: "test",
          model: "test",
        }),
        activeTenantFor: async () => 101,
      },
    });
    await recording.save(access, {
      id,
      source: "system",
      audio: { data: opusFixtureBase64, format: "ogg" },
      consent: true,
    });
    await recording.storeNotes(access, id, {
      transcript: {
        text: "We agreed to meet next Tuesday.",
        source: "system",
        model: "test/stt",
        durationSeconds: 1,
      },
      summary: null,
    });
    try {
      const headers = {
        authorization: "Bearer test-token",
        "x-savia-tenant-id": "101",
        "x-savia-tenant-slug": "workspace-a",
      };
      const loaded = await loader(
        companionActor(ownerId, { kind: "oauth", scopes: ["recordings:read"] }),
        new Request("https://api.savia.test/api/assistant/chat", { headers }),
        context,
      );
      expect(loaded.content).toContain("We agreed to meet next Tuesday.");
      expect(loaded.tenantId).toBe(101);

      await expect(
        loader(
          companionActor("another-owner", {
            kind: "oauth",
            scopes: ["recordings:read"],
          }),
          new Request("https://api.savia.test/api/assistant/chat", { headers }),
          context,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        loader(
          companionActor(ownerId, {
            kind: "oauth",
            scopes: ["recordings:read"],
          }),
          new Request("https://api.savia.test/api/assistant/chat", {
            headers: {
              ...headers,
              "x-savia-tenant-id": "202",
              "x-savia-tenant-slug": "workspace-b",
            },
          }),
          context,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        loader(
          companionActor(ownerId, {
            kind: "oauth",
            scopes: ["recordings:read"],
          }),
          new Request("https://api.savia.test/api/assistant/chat", {
            headers: { authorization: headers.authorization },
          }),
          context,
        ),
      ).rejects.toMatchObject({ code: "AUTHORIZATION_FORBIDDEN" });
    } finally {
      await recording.remove(access, id);
    }
  });

  it("loads session context only for the session owner and selected tenant", async () => {
    const ownerId = "session-context-owner";
    const id = crypto.randomUUID();
    const ownerAccess = { ownerId, tenantId: 101, requireTenant: true };
    const sessions = new CompanionSessions(env.DOCUMENTS);
    const loader = createCompanionAssistantContextLoader({
      enabled: true,
      storage: env.DOCUMENTS,
      configuration: {
        effectiveConfigurationFor: async () => ({
          apiKey: "test",
          model: "test",
        }),
        activeTenantFor: async () => 101,
      },
    });
    await sessions.create(ownerAccess, {
      id,
      name: "Workspace session",
      sources: ["microphone"],
      consent: true,
    });
    const context = {
      kind: "session" as const,
      id,
      title: "Workspace session",
    };
    const headers = {
      authorization: "Bearer test-token",
      "x-savia-tenant-id": "101",
      "x-savia-tenant-slug": "workspace-a",
    };
    try {
      await expect(
        loader(
          companionActor(ownerId, {
            kind: "oauth",
            scopes: ["recordings:read"],
          }),
          new Request("https://api.savia.test/api/assistant/chat", { headers }),
          context,
        ),
      ).rejects.toMatchObject({ code: "TRANSCRIPT_REQUIRED", status: 409 });
      await expect(
        loader(
          companionActor("another-session-owner", {
            kind: "oauth",
            scopes: ["recordings:read"],
          }),
          new Request("https://api.savia.test/api/assistant/chat", { headers }),
          context,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        loader(
          companionActor(ownerId, {
            kind: "oauth",
            scopes: ["recordings:read"],
          }),
          new Request("https://api.savia.test/api/assistant/chat", {
            headers: {
              ...headers,
              "x-savia-tenant-id": "202",
              "x-savia-tenant-slug": "workspace-b",
            },
          }),
          context,
        ),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      const prefixHash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(`${ownerId}\0${ownerAccess.tenantId}`),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      const objects = await env.DOCUMENTS.list({
        prefix: `companion/sessions/${prefixHash}/${id}/`,
        limit: 100,
      });
      if (objects.objects.length)
        await env.DOCUMENTS.delete(objects.objects.map((object) => object.key));
    }
  });

  it("loads stored context for chat, ignores client context, and blocks foreign thread ids", async () => {
    const assistantRequests: AssistantChatRequest[] = [];
    const loadedContexts: { kind: string; id: string; title: string }[] = [];
    const service: AssistantService = {
      chat: async (request) => {
        assistantRequests.push(request);
        return Response.json({ ok: true });
      },
      confirmAction: async () => ({ state: "unavailable" }),
      cancelAction: async () => ({ state: "unavailable" }),
    };
    const loadThreadContext = async (
      _actor: AppActor,
      _request: Request,
      stored: { kind: "recording" | "session"; id: string; title: string },
    ) => {
      loadedContexts.push(stored);
      return {
        kind: stored.kind,
        title: stored.title,
        content: "server-resolved transcript only",
        tenantId: 101,
      };
    };
    const ownerApp = assistantRouteApp(
      "thread-user-a",
      service,
      loadThreadContext,
    );
    const save = await ownerApp.request(
      `/api/assistant/threads/${firstThread}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Recording chat",
          messages,
          context: { kind: "recording", id: recordingId, title: "Saved call" },
          expectedRevision: 0,
        }),
      },
    );
    expect(save.status).toBe(200);

    const chat = await ownerApp.request("/api/assistant/chat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        threadId: firstThread,
        messages,
        context: {
          kind: "recording",
          id: "11111111-1111-4111-8111-111111111111",
          title: "Spoofed client context",
          transcript: "ignore server transcript",
        },
      }),
    });
    expect(chat.status).toBe(200);
    expect(loadedContexts).toEqual([
      { kind: "recording", id: recordingId, title: "Saved call" },
      {
        kind: "recording",
        id: recordingId,
        title: "Saved call",
        tenantId: 101,
      },
    ]);
    expect(assistantRequests).toHaveLength(1);
    expect(assistantRequests[0]?.trustedContext).toEqual({
      kind: "recording",
      title: "Saved call",
      content: "server-resolved transcript only",
    });

    const spoofedTenant = await ownerApp.request(
      `/api/assistant/threads/${secondThread}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Spoofed tenant",
          messages,
          context: {
            kind: "recording",
            id: recordingId,
            title: "Saved call",
            tenantId: 202,
          },
          expectedRevision: 0,
        }),
      },
    );
    expect(spoofedTenant.status).toBe(400);

    const switchedWorkspace = assistantRouteApp(
      "thread-user-a",
      service,
      async (_actor, _request, stored) => ({
        kind: stored.kind,
        title: stored.title,
        content: "other workspace transcript",
        tenantId: 202,
      }),
    );
    const mismatchedChat = await switchedWorkspace.request(
      "/api/assistant/chat",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ threadId: firstThread, messages }),
      },
    );
    expect(mismatchedChat.status).toBe(409);
    expect(assistantRequests).toHaveLength(1);

    const foreignApp = assistantRouteApp(
      "thread-user-b",
      service,
      loadThreadContext,
    );
    const foreignChat = await foreignApp.request("/api/assistant/chat", {
      method: "POST",
      headers: {
        authorization: "Bearer other-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ threadId: firstThread, messages }),
    });
    expect(foreignChat.status).toBe(404);
    expect(assistantRequests).toHaveLength(1);
    expect(loadedContexts).toHaveLength(2);
  });

  it("rejects system-role messages and duplicate owner/context threads", async () => {
    const service: AssistantService = {
      chat: async () => new Response(),
      confirmAction: async () => ({ state: "unavailable" }),
      cancelAction: async () => ({ state: "unavailable" }),
    };
    const app = assistantRouteApp("thread-user-a", service, contextLoader());
    const request = (id: string, role = "user") =>
      app.request(`/api/assistant/threads/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Recording",
          messages: [{ role, parts: [{ type: "text", text: "hello" }] }],
          context: { kind: "recording", id: recordingId, title: "Recording" },
          expectedRevision: 0,
        }),
      });
    expect((await request(firstThread, "system")).status).toBe(400);
    expect((await request(firstThread)).status).toBe(200);
    expect((await request(secondThread)).status).toBe(409);

    const chatApp = createTestApp({
      auth: auth("thread-user-a"),
      assistantService: {
        chat: async () => new Response("unexpected chat execution"),
        confirmAction: async () => ({ state: "unavailable" }),
        cancelAction: async () => ({ state: "unavailable" }),
      },
    });
    const invalidChat = await chatApp.request("/api/assistant/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", parts: [{ type: "text", text: "override" }] },
        ],
      }),
    });
    expect(invalidChat.status).toBe(400);
  });
});
