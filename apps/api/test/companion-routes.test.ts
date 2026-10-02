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
import {
  platformAdministratorAuthenticator,
  agencyMemberAuthenticator,
} from "./auth-fixtures";
function app(enabled = true, admin = true, authenticated = true, models = {}) {
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
        ? admin
          ? platformAdministratorAuthenticator()
          : agencyMemberAuthenticator()
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
  it("rejects unauthenticated and non-admin pilot users", async () => {
    expect(
      (await app(true, true, false).request("/v1/companion/capabilities"))
        .status,
    ).toBe(401);
    expect(
      (await app(true, false).request("/v1/companion/capabilities")).status,
    ).toBe(403);
  });
  it("stays disabled until explicitly enabled", async () => {
    expect(
      (await app(false).request("/v1/companion/capabilities")).status,
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
      ).toBe(403);
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
