import { requireOAuthScope } from "../src/auth/oauth-resource";
import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { registerCompanionRoutes } from "../src/companion/routes";
import { CompanionSessions } from "../src/companion/sessions";
import { CompanionSessionJobs } from "../src/companion/session-jobs";
import { CompanionService } from "../src/companion/service";
import {
  authenticationErrorResponse,
  authenticationMiddleware,
} from "../src/auth/middleware";
import type { Authenticator } from "../src/auth/types";
import { AuthenticationError } from "../src/auth/types";
import { requiredRecordingScope } from "../src/auth/recording-scope-policy";
import { authorizePersonalApiKeyRequest } from "../src/auth/personal-api-key-policy";
import type { RecordingScope } from "../src/auth/personal-api-keys";
import { opusFixture } from "./fixtures/companion-tone";

function workspaceAuthenticator(
  scopes = ["recordings:read", "recordings:upload", "recordings:process"],
): Authenticator {
  return {
    async authenticate(request) {
      requireOAuthScope(
        { scopes: new Set(scopes) } as Parameters<typeof requireOAuthScope>[0],
        request,
      );
      return {
        principal: {
          id: "session-route-member",
          issuer: "savia:better-auth",
          subject: "session-route-member",
          email: "member@savia.test",
          displayName: "Session Route Member",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        credential: { kind: "oauth", scopes },
        globalRoles: [],
        memberships: [101, 202].map((tenantId) => ({
          id: `membership-${tenantId}`,
          principalId: "session-route-member",
          tenantId,
          agencyId: tenantId,
          tenantName: `Workspace ${tenantId}`,
          tenantSlug: `workspace-${tenantId}`,
          role: "viewer",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        })),
      };
    },
  };
}

function app(service: CompanionService, scopes?: string[]) {
  const result = new OpenAPIHono();
  result.onError((error) =>
    error instanceof AuthenticationError
      ? authenticationErrorResponse(error)
      : Response.json({ error: { code: "ERROR" } }, { status: 500 }),
  );
  result.use(
    "/v1/companion/*",
    authenticationMiddleware({} as D1Database, workspaceAuthenticator(scopes)),
  );
  registerCompanionRoutes(result, {
    enabled: true,
    storage: env.DOCUMENTS,
    service,
    configuration: {
      effectiveConfigurationFor: async () => ({
        apiKey: "test-key",
        model: "test/summary",
      }),
      effectiveConfigurationForTenant: async (_ownerId, tenantId) => ({
        apiKey: `tenant-${tenantId}-key`,
        model: "test/summary",
        transcriptionModel: "test/transcription",
      }),
      activeTenantFor: async () => 101,
    },
  });
  return result;
}

const tenantHeaders = (tenantId: number) => ({
  "x-savia-tenant-id": String(tenantId),
  "x-savia-tenant-slug": `workspace-${tenantId}`,
});

describe("Companion long recording routes", () => {
  it("queues, persists transcript and summary, answers with evidence, and enforces tenant access", async () => {
    const fixture = opusFixture();
    const audioData = btoa(
      Array.from(fixture, (byte) => String.fromCharCode(byte)).join(""),
    );
    const service = {
      sttModel: "test/transcription",
      async transcribe(_config: unknown, input: { source: string }) {
        return {
          text: "The budget is 45 dollars.",
          source: input.source,
          model: "test/transcription",
          durationSeconds: 0.1,
        };
      },
      async summarize() {
        return {
          summary: "The budget is 45 dollars.",
          decisions: [],
          actions: [],
          openQuestions: [],
        };
      },
      async answer() {
        return {
          answer: "The budget is 45 dollars.",
          insufficientEvidence: false,
        };
      },
    } as unknown as CompanionService;
    const instance = app(service);
    const sessions = new CompanionSessions(env.DOCUMENTS);
    const id = crypto.randomUUID();
    const headers = {
      ...tenantHeaders(101),
      "content-type": "application/json",
    };
    const create = await instance.request("/v1/companion/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id,
        name: "Budget meeting",
        sources: ["microphone"],
        consent: true,
      }),
    });
    expect(create.status).toBe(200);
    await expect(create.json()).resolves.toMatchObject({
      id,
      state: "uploading",
    });

    const upload = await instance.request(
      `/v1/companion/sessions/${id}/chunks`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          source: "microphone",
          sequence: 0,
          startSeconds: 0,
          audio: { data: audioData, format: "ogg" },
        }),
      },
    );
    expect(upload.status).toBe(200);
    const finalize = await instance.request(
      `/v1/companion/sessions/${id}/finalize`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ expectedChunks: 1, durationSeconds: 1 }),
      },
    );
    expect(finalize.status).toBe(200);

    const queued = await instance.request(
      `/v1/companion/sessions/${id}/notes`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ consent: true }),
      },
    );
    expect(queued.status).toBe(200);
    await expect(queued.json()).resolves.toMatchObject({
      job: { status: "queued" },
    });

    const engine = new CompanionSessionJobs(
      sessions,
      service,
      async (_ownerId, tenantId) => ({
        apiKey: `tenant-${tenantId}-key`,
        model: "test/summary",
      }),
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      if (
        (
          await sessions.get(
            {
              ownerId: "session-route-member",
              tenantId: 101,
              requireTenant: true,
            },
            id,
          )
        ).job.status === "complete"
      )
        break;
      await engine.processOne();
    }
    const uploadOnly = app(service, ["recordings:upload"]);
    const duplicateCreate = await uploadOnly.request("/v1/companion/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id,
        name: "Budget meeting",
        sources: ["microphone"],
        consent: true,
      }),
    });
    expect(duplicateCreate.status).toBe(200);
    expect(await duplicateCreate.json()).not.toHaveProperty("job");
    expect(
      (
        await uploadOnly.request(`/v1/companion/sessions/${id}`, {
          headers: tenantHeaders(101),
        })
      ).status,
    ).toBe(403);
    const get = await instance.request(`/v1/companion/sessions/${id}`, {
      headers: tenantHeaders(101),
    });
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({
      state: "ready",
      job: {
        status: "complete",
        transcripts: { "microphone:0": { text: "The budget is 45 dollars." } },
        summary: { summary: "The budget is 45 dollars." },
      },
    });

    const question = await instance.request(
      `/v1/companion/sessions/${id}/questions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          question: "What is the budget?",
          consent: true,
        }),
      },
    );
    expect(question.status).toBe(200);
    await expect(question.json()).resolves.toMatchObject({
      answer: "The budget is 45 dollars.",
      partial: false,
      evidence: [{ source: "microphone", sequence: 0, startSeconds: 0 }],
    });

    const crossTenant = await instance.request(`/v1/companion/sessions/${id}`, {
      headers: tenantHeaders(202),
    });
    expect(crossTenant.status).toBe(404);
    const unavailableWithoutWorkspace = await instance.request(
      `/v1/companion/sessions/${id}`,
    );
    expect(unavailableWithoutWorkspace.status).toBe(403);
  });

  it("maps route operations to their required recording scopes", () => {
    const request = new Request("https://savia.test/v1/companion/sessions", {
      method: "POST",
    });
    const scope = requiredRecordingScope(request);
    expect(scope).toBe("recordings:upload");
    expect(() =>
      authorizePersonalApiKeyRequest(request, [scope as RecordingScope]),
    ).not.toThrow();
    expect(() =>
      authorizePersonalApiKeyRequest(request, ["recordings:read"]),
    ).toThrow();
  });
});
