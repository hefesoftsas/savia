import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { registerCompanionRoutes } from "../src/companion/routes";
import { CompanionRecordings } from "../src/companion/recordings";
import { CompanionService } from "../src/companion/service";
import {
  authenticationErrorResponse,
  authenticationMiddleware,
} from "../src/auth/middleware";
import { AuthenticationError, type Authenticator } from "../src/auth/types";
import { opusFixtureBase64 } from "./fixtures/companion-tone";

function oauthWorkspaceAuthenticator(
  scopes = ["recordings:read", "recordings:process"],
  inactiveB = false,
): Authenticator {
  return {
    async authenticate() {
      return {
        principal: {
          id: "mobile-member",
          issuer: "savia:better-auth",
          subject: "mobile-member",
          email: "mobile@savia.test",
          displayName: "Mobile Member",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        credential: { kind: "oauth", scopes },
        globalRoles: [],
        memberships: [
          {
            id: "workspace-a-membership",
            principalId: "mobile-member",
            tenantId: 101,
            agencyId: 101,
            tenantName: "Workspace A",
            tenantSlug: "workspace-a",
            role: "viewer",
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "workspace-b-membership",
            principalId: "mobile-member",
            tenantId: 202,
            agencyId: 202,
            tenantName: "Workspace B",
            tenantSlug: "workspace-b",
            role: "viewer",
            isActive: !inactiveB,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
    },
  };
}

function testApp(
  authenticator: Authenticator,
  configuration: {
    effectiveConfigurationFor: (principalId: string) => Promise<{
      apiKey: string;
      model: string;
      transcriptionModel?: string;
      summaryModel?: string;
    }>;
    effectiveConfigurationForTenant: (
      principalId: string,
      tenantId: number,
    ) => Promise<{
      apiKey: string;
      model: string;
      transcriptionModel?: string;
      summaryModel?: string;
    }>;
    activeTenantFor: (principalId: string) => Promise<number | undefined>;
  },
  service: CompanionService,
) {
  const app = new OpenAPIHono();
  app.onError((error) =>
    error instanceof AuthenticationError
      ? authenticationErrorResponse(error)
      : Response.json({ error: { code: "ERROR" } }, { status: 500 }),
  );
  app.use(
    "/v1/companion/*",
    authenticationMiddleware({} as D1Database, authenticator),
  );
  registerCompanionRoutes(app, {
    enabled: true,
    storage: env.DOCUMENTS,
    service,
    configuration,
  });
  return app;
}

describe("narrow OAuth Companion workspace configuration", () => {
  it("uses the selected workspace configuration instead of the active workspace", async () => {
    const configCalls: string[] = [];
    const service = new CompanionService({
      fetch: async () => Response.json({}),
    });
    const app = testApp(
      oauthWorkspaceAuthenticator(),
      {
        effectiveConfigurationFor: async () => {
          configCalls.push("active");
          return { apiKey: "workspace-a-key", model: "workspace-a/model" };
        },
        effectiveConfigurationForTenant: async (_principalId, tenantId) => {
          configCalls.push(`tenant:${tenantId}`);
          return {
            apiKey: `workspace-${tenantId}-key`,
            model: `workspace-${tenantId}/model`,
            transcriptionModel: `workspace-${tenantId}/transcription`,
          };
        },
        activeTenantFor: async () => 101,
      },
      service,
    );

    const response = await app.request("/v1/companion/capabilities", {
      headers: { "x-savia-tenant-id": "202" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sttModel: "workspace-202/transcription",
      summaryModel: "workspace-202/model",
    });
    expect(configCalls).toEqual(["tenant:202"]);
  });

  it("uses the selected workspace credentials for processing", async () => {
    const configCalls: string[] = [];
    const providerAuthorization: string[] = [];
    const service = new CompanionService({
      fetch: async (input, init) => {
        providerAuthorization.push(
          new Headers(init?.headers).get("authorization") ?? "",
        );
        return String(input).includes("transcriptions")
          ? Response.json({ text: "Selected workspace transcript" })
          : Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: "Selected workspace summary",
                      decisions: [],
                      actions: [],
                      openQuestions: [],
                    }),
                  },
                },
              ],
            });
      },
    });
    const app = testApp(
      oauthWorkspaceAuthenticator(["recordings:process"]),
      {
        effectiveConfigurationFor: async () => {
          configCalls.push("active");
          return { apiKey: "workspace-a-key", model: "workspace-a/model" };
        },
        effectiveConfigurationForTenant: async (_principalId, tenantId) => {
          configCalls.push(`tenant:${tenantId}`);
          return {
            apiKey: `workspace-${tenantId}-key`,
            model: `workspace-${tenantId}/model`,
          };
        },
        activeTenantFor: async () => 101,
      },
      service,
    );
    const recordings = new CompanionRecordings(env.DOCUMENTS);
    const id = crypto.randomUUID();
    await recordings.save(
      { ownerId: "mobile-member", tenantId: 202, requireTenant: true },
      {
        id,
        source: "system",
        audio: { data: opusFixtureBase64, format: "ogg" },
        consent: true,
      },
    );

    try {
      const response = await app.request(
        `/v1/companion/recordings/${id}/notes`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-savia-tenant-id": "202",
          },
          body: JSON.stringify({ consent: true }),
        },
      );

      expect(response.status).toBe(200);
      expect(configCalls).toEqual(["tenant:202"]);
      expect(providerAuthorization).toEqual([
        "Bearer workspace-202-key",
        "Bearer workspace-202-key",
      ]);
    } finally {
      await recordings.remove(
        { ownerId: "mobile-member", tenantId: 202, requireTenant: true },
        id,
      );
    }
  });

  it.each([
    ["missing", "999", false],
    ["inactive", "202", true],
  ])(
    "rejects a %s selected workspace before provider calls",
    async (_label, tenantId, inactiveB) => {
      let configCalls = 0;
      let providerCalls = 0;
      const service = new CompanionService({
        fetch: async () => {
          providerCalls++;
          return Response.json({ text: "unexpected" });
        },
      });
      const app = testApp(
        oauthWorkspaceAuthenticator(["recordings:process"], inactiveB),
        {
          effectiveConfigurationFor: async () => {
            configCalls++;
            return { apiKey: "workspace-a-key", model: "workspace-a/model" };
          },
          effectiveConfigurationForTenant: async () => {
            configCalls++;
            return { apiKey: "workspace-b-key", model: "workspace-b/model" };
          },
          activeTenantFor: async () => 101,
        },
        service,
      );

      const response = await app.request(
        "/v1/companion/recordings/123e4567-e89b-42d3-a456-426614174000/notes",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-savia-tenant-id": tenantId,
          },
          body: JSON.stringify({ consent: true }),
        },
      );

      expect(response.status).toBe(403);
      expect(configCalls).toBe(0);
      expect(providerCalls).toBe(0);
    },
  );
});
