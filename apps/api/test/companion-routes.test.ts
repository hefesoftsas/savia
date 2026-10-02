import { opusFixtureBase64 } from "./fixtures/companion-tone";
import { env } from "cloudflare:workers";
import { createApp } from "../src/app";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { registerCompanionRoutes } from "../src/companion/routes";
import {
  authenticationMiddleware,
  authenticationErrorResponse,
} from "../src/auth/middleware";
import { AuthenticationError } from "../src/auth/types";
import type { Authenticator } from "../src/auth/types";
import { CompanionService } from "../src/companion/service";
import {
  platformAdministratorAuthenticator,
  agencyMemberAuthenticator,
} from "./auth-fixtures";
function app(
  enabled = true,
  admin = true,
  authenticated = true,
  models = {},
  authenticator?: Authenticator,
  service?: CompanionService,
) {
  const result = new OpenAPIHono();
  result.onError((error) =>
    error instanceof AuthenticationError
      ? authenticationErrorResponse(error)
      : Response.json({ error: { code: "ERROR" } }, { status: 500 }),
  );
  result.use(
    "/v1/companion/*",
    authenticationMiddleware(
      {} as D1Database,
      authenticated
        ? (authenticator ??
            (admin
              ? platformAdministratorAuthenticator()
              : agencyMemberAuthenticator()))
        : {
            authenticate: async () => {
              throw new AuthenticationError(
                "AUTHENTICATION_REQUIRED",
                "Sign in",
              );
            },
          },
    ),
  );
  registerCompanionRoutes(result, {
    enabled,
    storage: env.DOCUMENTS,
    service,
    configuration: {
      effectiveConfigurationFor: async () => ({
        apiKey: "never-return-this",
        model: "test/summary",
        ...models,
      }),
    },
  });
  return result;
}
function memberAuthenticator(
  principalId: string,
  role: string,
  options: { principalActive?: boolean; membershipActive?: boolean } = {},
): Authenticator {
  return {
    async authenticate() {
      return {
        principal: {
          id: principalId,
          issuer: "savia:better-auth",
          subject: principalId,
          email: `${principalId}@savia.test`,
          displayName: principalId,
          isActive: options.principalActive ?? true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        globalRoles: [],
        memberships: [
          {
            id: `${principalId}-membership`,
            principalId,
            tenantId: 101,
            agencyId: 101,
            role,
            isActive: options.membershipActive ?? true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
    },
  };
}
describe("Companion API boundaries", () => {
  it("is registered behind authentication in the real Savia app", async () => {
    const instance = createApp(
      env.DB,
      undefined,
      undefined,
      platformAdministratorAuthenticator(),
    );
    expect((await instance.request("/v1/companion/capabilities")).status).toBe(
      503,
    );
    expect(
      instance.getOpenAPI31Document({
        openapi: "3.1.0",
        info: { title: "Savia", version: "1" },
      }).paths,
    ).toHaveProperty("/v1/companion/transcribe");
  });
  it("rejects unauthenticated requests but accepts active tenant members", async () => {
    expect(
      (await app(true, true, false).request("/v1/companion/capabilities"))
        .status,
    ).toBe(401);
    expect(
      (await app(true, false).request("/v1/companion/capabilities")).status,
    ).toBe(200);
    expect(
      (
        await app(
          true,
          true,
          true,
          {},
          memberAuthenticator("inactive-principal", "viewer", {
            principalActive: false,
          }),
        ).request("/v1/companion/capabilities")
      ).status,
    ).toBe(403);
    expect(
      (
        await app(
          true,
          true,
          true,
          {},
          memberAuthenticator("inactive-membership", "viewer", {
            membershipActive: false,
          }),
        ).request("/v1/companion/capabilities")
      ).status,
    ).toBe(403);
    const membershipless = platformAdministratorAuthenticator();
    const authenticateAdmin = membershipless.authenticate.bind(membershipless);
    const inactiveActor: Authenticator = {
      async authenticate(request, db) {
        const actor = await authenticateAdmin(request, db);
        return { ...actor, globalRoles: [], memberships: [] };
      },
    };
    expect(
      (
        await app(true, true, true, {}, inactiveActor).request(
          "/v1/companion/capabilities",
        )
      ).status,
    ).toBe(403);
    const inactiveAdmin: Authenticator = {
      async authenticate(request, db) {
        const actor = await authenticateAdmin(request, db);
        return { ...actor, principal: { ...actor.principal, isActive: false } };
      },
    };
    expect(
      (
        await app(true, true, true, {}, inactiveAdmin).request(
          "/v1/companion/capabilities",
        )
      ).status,
    ).toBe(403);
  });

  it.each(["viewer", "operator", "tenant_admin"])(
    "allows active %s members to use their own recordings and hides another member's recordings",
    async (role) => {
      const owner = app();
      const ownerId = crypto.randomUUID();
      const save = await owner.request("/v1/companion/recordings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: ownerId,
          source: "system",
          audio: { data: opusFixtureBase64, format: "ogg" },
          consent: true,
        }),
      });
      expect(save.status).toBe(200);
      const memberId = `member-${role}`;
      const memberService = new CompanionService({
        fetch: async (input) =>
          String(input).includes("transcriptions")
            ? Response.json({ text: "Member transcript" })
            : Response.json({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        summary: "Member notes",
                        decisions: [],
                        actions: [],
                        openQuestions: [],
                      }),
                    },
                  },
                ],
              }),
      });
      const member = app(
        true,
        true,
        true,
        {},
        memberAuthenticator(memberId, role),
        memberService,
      );
      const ownId = crypto.randomUUID();
      try {
        expect((await member.request("/v1/companion/recordings")).status).toBe(
          200,
        );
        const upload = await member.request("/v1/companion/recordings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: ownId,
            source: "system",
            audio: { data: opusFixtureBase64, format: "ogg" },
            consent: true,
          }),
        });
        expect(upload.status).toBe(200);
        const ownNotes = await member.request(
          `/v1/companion/recordings/${ownId}/notes`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ consent: true }),
          },
        );
        expect(ownNotes.status).toBe(200);
        const ownAudio = await member.request(
          `/v1/companion/recordings/${ownId}`,
        );
        expect(ownAudio.status).toBe(200);
        expect(new Uint8Array(await ownAudio.arrayBuffer())).toEqual(
          Uint8Array.from(atob(opusFixtureBase64), (c) => c.charCodeAt(0)),
        );
        expect(
          await member
            .request("/v1/companion/recordings")
            .then((r) => r.json()),
        ).toMatchObject({
          recordings: [expect.objectContaining({ id: ownId })],
        });

        let providerCalls = 0;
        const blockedService = new CompanionService({
          fetch: async () => {
            providerCalls++;
            return Response.json({ text: "should never run" });
          },
        });
        const otherMember = app(
          true,
          true,
          true,
          {},
          memberAuthenticator(`other-${role}`, role),
          blockedService,
        );
        const otherList = await otherMember.request("/v1/companion/recordings");
        expect(otherList.status).toBe(200);
        expect(await otherList.json()).toMatchObject({ recordings: [] });
        expect(
          await otherMember.request(`/v1/companion/recordings/${ownId}`),
        ).toHaveProperty("status", 404);
        expect(
          (await otherMember.request(`/v1/companion/recordings/${ownId}/notes`))
            .status,
        ).toBe(404);
        expect(
          (
            await otherMember.request(
              `/v1/companion/recordings/${ownId}/notes`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ consent: true }),
              },
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await otherMember.request(`/v1/companion/recordings/${ownId}`, {
              method: "DELETE",
            })
          ).status,
        ).toBe(404);
        expect(
          (await member.request(`/v1/companion/recordings/${ownId}`)).status,
        ).toBe(200);
        expect(providerCalls).toBe(0);
      } finally {
        await member
          .request(`/v1/companion/recordings/${ownId}`, { method: "DELETE" })
          .catch(() => {});
        await owner
          .request(`/v1/companion/recordings/${ownerId}`, { method: "DELETE" })
          .catch(() => {});
      }
    },
  );
  it("stays disabled until explicitly enabled", async () => {
    expect(
      (await app(false).request("/v1/companion/capabilities")).status,
    ).toBe(503);
    expect(
      (
        await app(
          false,
          true,
          true,
          {},
          memberAuthenticator("disabled-member", "viewer"),
        ).request("/v1/companion/capabilities")
      ).status,
    ).toBe(503);
  });
  it("returns model capabilities without any provider secret", async () => {
    const response = await app().request("/v1/companion/capabilities");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).toContain("maxDurationSeconds");
    expect(text).not.toContain("never-return-this");
  });
  it("reports persisted meeting models in capabilities", async () => {
    const response = await app(true, true, true, {
      transcriptionModel: "openai/whisper-large-v3-turbo",
      summaryModel: "openai/gpt-4o-mini",
    }).request("/v1/companion/capabilities");

    await expect(response.json()).resolves.toMatchObject({
      sttModel: "openai/whisper-large-v3-turbo",
      summaryModel: "openai/gpt-4o-mini",
    });
  });
  it("rejects missing consent and malformed payload without provider calls", async () => {
    const response = await app().request("/v1/companion/transcribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "system",
        audio: { data: "invalid", format: "wav" },
      }),
    });
    expect(response.status).toBe(400);
  });
  it("enforces body bytes even with a forged content-length", async () => {
    const response = await app().request("/v1/companion/summarize", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1" },
      body: JSON.stringify({ text: "x".repeat(150000) }),
    });
    expect(response.status).toBe(413);
  });
  it("saves, lists, downloads and deletes a private compressed sample", async () => {
    const instance = app();
    const id = crypto.randomUUID();
    const response = await instance.request("/v1/companion/recordings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        source: "system",
        audio: { data: opusFixtureBase64, format: "ogg" },
        consent: true,
      }),
    });
    expect(response.status).toBe(200);
    try {
      expect(await response.json()).toMatchObject({
        id,
        format: "ogg",
        durationSeconds: 0.1,
      });
      const list = await instance.request("/v1/companion/recordings");
      expect(await list.json()).toMatchObject({
        recordings: [expect.objectContaining({ id })],
      });
      const download = await instance.request(`/v1/companion/recordings/${id}`);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("audio/ogg");
      expect((await download.arrayBuffer()).byteLength).toBe(644);
      expect(
        (await app(true, false).request(`/v1/companion/recordings/${id}`))
          .status,
      ).toBe(404);
    } finally {
      expect(
        (
          await instance.request(`/v1/companion/recordings/${id}`, {
            method: "DELETE",
          })
        ).status,
      ).toBe(204);
    }
    expect(
      (await instance.request(`/v1/companion/recordings/${id}`)).status,
    ).toBe(404);
  });
  it("publishes routes through generated OpenAPI", () => {
    const document = app().getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Test", version: "1" },
    });
    expect(document.paths).toHaveProperty("/v1/companion/transcribe");
    expect(document.paths).toHaveProperty(
      "/v1/companion/recordings/{id}/notes",
    );
    expect(
      document.paths["/v1/companion/recordings/{id}/notes"],
    ).toHaveProperty("get");
    expect(
      document.paths["/v1/companion/recordings/{id}/notes"],
    ).toHaveProperty("post");
  });
});
