import { parseSocialSettings } from "../src/social-sign-in";
import { describe, expect, it } from "vitest";
import {
  chatgptOAuthConfiguration,
  chatgptIdentity,
} from "../src/chatgpt-sign-in";

describe("ChatGPT identity-only website sign-in", () => {
  it("stays unavailable without an approved website client", () => {
    expect(chatgptOAuthConfiguration({})).toBeNull();
    expect(() =>
      chatgptOAuthConfiguration({
        SAVIA_CHATGPT_CLIENT_ID: "dynamic_agent_client_example",
      }),
    ).toThrow();
    expect(() =>
      chatgptOAuthConfiguration({ SAVIA_CHATGPT_CLIENT_SECRET: "secret" }),
    ).toThrow();
  });
  it("requires PKCE and verified ID tokens without requesting API access", () => {
    expect(
      chatgptOAuthConfiguration({ SAVIA_CHATGPT_CLIENT_ID: "oaiapp_test" }),
    ).toMatchObject({
      providerId: "chatgpt",
      clientId: "oaiapp_test",
      pkce: true,
      requireIdTokenVerification: true,
      scopes: ["openid", "profile", "email"],
      tokenEndpointAuth: { method: "none" },
      disableProviderLogout: true,
    });
  });
  it("uses only the registered token authentication method", () => {
    expect(() =>
      chatgptOAuthConfiguration({
        SAVIA_CHATGPT_CLIENT_ID: "oaiapp_test",
        SAVIA_CHATGPT_CLIENT_SECRET: "secret",
      }),
    ).toThrow();
    expect(() =>
      chatgptOAuthConfiguration({
        SAVIA_CHATGPT_CLIENT_ID: "oaiapp_test",
        SAVIA_CHATGPT_TOKEN_AUTH_METHOD: "client_secret_basic",
      }),
    ).toThrow();
    expect(
      chatgptOAuthConfiguration({
        SAVIA_CHATGPT_CLIENT_ID: "oaiapp_test",
        SAVIA_CHATGPT_CLIENT_SECRET: "secret",
        SAVIA_CHATGPT_TOKEN_AUTH_METHOD: "client_secret_post",
      }),
    ).toMatchObject({ tokenEndpointAuth: { method: "client_secret_post" } });
  });
  it("scopes immutable identity to issuer, client and subject, never email", async () => {
    const profile = {
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      iss: "https://auth.openai.com",
      sub: "subject",
      email: "member@example.com",
      email_verified: true,
    };
    const first = await chatgptIdentity(profile, "oaiapp_a");
    expect(
      (
        await chatgptIdentity(
          { ...profile, email: "changed@example.com" },
          "oaiapp_a",
        )
      ).id,
    ).toBe(first.id);
    expect((await chatgptIdentity(profile, "oaiapp_b")).id).not.toBe(first.id);
    expect(
      (await chatgptIdentity({ ...profile, sub: "other" }, "oaiapp_a")).id,
    ).not.toBe(first.id);
    await expect(
      chatgptIdentity(
        { ...profile, iss: "https://other.example.com" },
        "oaiapp_a",
      ),
    ).rejects.toThrow();
    await expect(
      chatgptIdentity({ ...profile, sub: "" }, "oaiapp_a"),
    ).rejects.toThrow();
    await expect(
      chatgptIdentity({ ...profile, exp: undefined }, "oaiapp_a"),
    ).rejects.toThrow();
    await expect(
      chatgptIdentity({ ...profile, iat: profile.iat + 600 }, "oaiapp_a"),
    ).rejects.toThrow();
  });
});

it("defaults tenant ChatGPT access off and validates explicit opt-in", () => {
  const base = {
    googleEnabled: false,
    microsoftEnabled: false,
    microsoftTenantId: "",
  };
  expect(parseSocialSettings(base)).toMatchObject({ chatgptEnabled: false });
  expect(parseSocialSettings({ ...base, chatgptEnabled: true })).toMatchObject({
    chatgptEnabled: true,
  });
  expect(() =>
    parseSocialSettings({ ...base, chatgptEnabled: "true" }),
  ).toThrow();
});
