import { applyD1Migrations, env as workerEnv } from "cloudflare:test";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiContext } from "../context";
import { createDatabase } from "../db";
import { organizations, users, memberships, workflows } from "../db/schema";
import { saviaBridgeMiddleware } from "../savia-bridge";
import wsRoutes from "./ws";
import { getWorkflowAgentByName } from "../durable-objects/agent-utils";

vi.mock("../durable-objects/agent-utils", () => ({
  getWorkflowAgentByName: vi.fn(),
}));

const secret = "savia-flows-ws-route-test-bridge-secret-32-bytes";
const userId = "ws-route-user";
const testEnv = workerEnv as unknown as {
  DB: D1Database;
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};
const env = {
  ...testEnv,
  SAVIA_FLOWS_BRIDGE_SECRET: secret,
  SAVIA_FLOWS_LOCAL_ONLY: "true",
} as unknown as ApiContext["Bindings"];

async function bridgeToken(
  organizationId: string,
  role: string,
  exp = Math.floor(Date.now() / 1000) + 60,
) {
  return new SignJWT({
    name: "Socket User",
    email: "socket-user@savia.test",
    organization: { id: organizationId, name: organizationId, role },
    platformAdmin: false,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("savia")
    .setAudience("savia-flows")
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));
}

function app() {
  const result = new Hono<ApiContext>();
  result.use("*", saviaBridgeMiddleware);
  result.route("/:organizationId/ws", wsRoutes);
  return result;
}

const fakeStubFetch = vi.fn(async (request: Request) =>
  Response.json({
    protocol: request.headers.get("x-agent-protocol"),
    userId: request.headers.get("x-user-id"),
    organizationId: request.headers.get("x-organization-id"),
    sessionExpiresAt: request.headers.get("x-savia-session-expires-at"),
  }),
);

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  const db = createDatabase(testEnv.DB);
  await db
    .insert(organizations)
    .values([
      { id: "tenant:101", name: "Tenant 101" },
      { id: "tenant:202", name: "Tenant 202" },
    ])
    .onConflictDoNothing();
  await db
    .insert(users)
    .values({ id: userId, name: "Socket User", organizationId: "tenant:101" })
    .onConflictDoNothing();
  await db
    .insert(memberships)
    .values([
      { userId, organizationId: "tenant:101", role: "admin" },
      { userId, organizationId: "tenant:202", role: "admin" },
    ])
    .onConflictDoNothing();
  await db
    .insert(workflows)
    .values([
      {
        id: "workflow-101",
        name: "Tenant 101 workflow",
        organizationId: "tenant:101",
      },
      {
        id: "workflow-202",
        name: "Tenant 202 workflow",
        organizationId: "tenant:202",
      },
    ])
    .onConflictDoNothing();
});

beforeEach(() => {
  fakeStubFetch.mockClear();
  vi.mocked(getWorkflowAgentByName).mockResolvedValue({
    fetch: fakeStubFetch,
  } as never);
});

describe("editor WebSocket tenant boundary", () => {
  it("does not open a workflow owned by another tenant", async () => {
    const response = await app().request(
      "/tenant:101/ws/workflow-202",
      {
        headers: {
          upgrade: "websocket",
          "x-savia-flows-context": await bridgeToken(
            "tenant:101",
            "tenant_admin",
          ),
        },
      },
      env,
    );

    expect(response.status).toBe(404);
    expect(fakeStubFetch).not.toHaveBeenCalled();
    expect(getWorkflowAgentByName).not.toHaveBeenCalled();
  });

  it("opens a same-tenant socket only for an editor manager and forwards a bounded session", async () => {
    const allowed = await app().request(
      "/tenant:101/ws/workflow-101",
      {
        headers: {
          upgrade: "websocket",
          "x-savia-flows-context": await bridgeToken(
            "tenant:101",
            "tenant_admin",
          ),
        },
      },
      env,
    );
    expect(allowed.status).toBe(200);
    const forwarded = await allowed.json<{
      protocol: string;
      userId: string;
      organizationId: string | null;
      sessionExpiresAt: string | null;
    }>();
    expect(forwarded).toMatchObject({
      protocol: "editor",
      userId,
      organizationId: "tenant:101",
    });
    const expiresAt = Number(forwarded.sessionExpiresAt);
    expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60);

    const denied = await app().request(
      "/tenant:101/ws/workflow-101",
      {
        headers: {
          upgrade: "websocket",
          "x-savia-flows-context": await bridgeToken("tenant:101", "member"),
        },
      },
      env,
    );
    expect(denied.status).toBe(403);
    expect(fakeStubFetch).toHaveBeenCalledTimes(1);
  });
});
