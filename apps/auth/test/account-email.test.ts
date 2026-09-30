import { env } from "cloudflare:workers";
import { afterAll, describe, expect, it, vi } from "vitest";
import { deliverSmtpEmail } from "../src/smtp";
import {
  accountEmailAvailable,
  accountEmailSettingsResponse,
  sendAccountEmail,
} from "../src/account-email";

vi.mock("../src/smtp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/smtp")>()),
  deliverSmtpEmail: vi.fn(async () => undefined),
}));

const tenantId = 870_000 + Math.floor(Math.random() * 100_000);
const environment = {
  ...env,
  BETTER_AUTH_SECRET: "test-email-settings-secret",
  SAVIA_INTERNAL_BRIDGE_KEY: "email-bridge-secret",
};
const settings = {
  host: "smtp.example.test",
  port: 587,
  security: "starttls",
  username: "savia@example.test",
  password: "a-secret-password",
  from: "no-reply@example.test",
};
const request = (
  method: string,
  suffix = "",
  body?: unknown,
  key = "email-bridge-secret",
) =>
  new Request(`https://auth.test/_internal/tenant-email/${tenantId}${suffix}`, {
    method,
    headers: {
      "x-savia-bridge-key": key,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

afterAll(async () => {
  await environment.AUTH_DB.prepare(
    "DELETE FROM tenant_email_settings WHERE tenant_id=?",
  )
    .bind(tenantId)
    .run()
    .catch(() => undefined);
});

describe("tenant account email settings", () => {
  it("reports only an available tenant or global delivery transport", async () => {
    const noGlobal = {
      ...environment,
      SAVIA_SMTP_HOST: undefined,
      SAVIA_SMTP_FROM: undefined,
      SAVIA_SMTP_PORT: undefined,
    };
    expect(await accountEmailAvailable(noGlobal, {})).toBe(false);
    expect(
      await accountEmailAvailable(noGlobal, {
        sendTransactionalEmail: vi.fn(async () => undefined),
      }),
    ).toBe(true);

    await accountEmailSettingsResponse(
      request("PUT", "", settings),
      environment,
      {},
    );
    expect(
      await accountEmailAvailable(
        { ...noGlobal, SAVIA_SMTP_HOST: "invalid host" },
        {},
        tenantId,
      ),
    ).toBe(true);
  });

  it("requires the internal bridge key and redacts secrets from responses", async () => {
    const denied = await accountEmailSettingsResponse(
      request("GET", "", undefined, "wrong"),
      environment,
      {},
    );
    expect(denied?.status).toBe(403);
    const saved = await accountEmailSettingsResponse(
      request("PUT", "", settings),
      environment,
      {},
    );
    expect(saved?.status).toBe(200);
    const result = await saved?.json();
    expect(result).toEqual({
      configured: true,
      host: settings.host,
      port: settings.port,
      username: settings.username,
      from: settings.from,
      security: settings.security,
      passwordConfigured: true,
    });
    expect(JSON.stringify(result)).not.toContain(settings.password);
    const encrypted = await environment.AUTH_DB.prepare(
      "SELECT ciphertext FROM tenant_email_settings WHERE tenant_id=?",
    )
      .bind(tenantId)
      .first<{ ciphertext: string }>();
    expect(encrypted?.ciphertext).not.toContain(settings.password);
  });

  it("retains an omitted password, supports explicit clearing, and encrypts per tenant", async () => {
    await accountEmailSettingsResponse(
      request("PUT", "", { ...settings, password: "" }),
      environment,
      {},
    );
    const delivered = vi.fn(async () => undefined);
    await sendAccountEmail(
      environment,
      { deliverEmail: delivered },
      { to: "person@example.test", subject: "Hello", text: "Test" },
      tenantId,
    );
    expect(delivered.mock.calls[0]?.[0].password).toBe(settings.password);
    await accountEmailSettingsResponse(
      request("PUT", "", { ...settings, username: "", password: null }),
      environment,
      {},
    );
    expect(
      (await accountEmailSettingsResponse(request("GET"), environment, {}))
        ?.status,
    ).toBe(200);
    const cleared = vi.fn(async () => undefined);
    await sendAccountEmail(
      environment,
      { deliverEmail: cleared },
      { to: "person@example.test", subject: "Hello", text: "Test" },
      tenantId,
    );
    expect(cleared.mock.calls[0]?.[0].password).toBe("");
  });

  it("rejects internal SMTP targets, malformed settings and invalid test recipients", async () => {
    const internalHost = await accountEmailSettingsResponse(
      request("PUT", "", { ...settings, host: "127.0.0.1" }),
      environment,
      {},
    );
    expect(internalHost?.status).toBe(400);
    const badFrom = await accountEmailSettingsResponse(
      request("PUT", "", { ...settings, from: "bad\r\nBcc:x@example.test" }),
      environment,
      {},
    );
    expect(badFrom?.status).toBe(400);
    const badPayload = await accountEmailSettingsResponse(
      request("POST", "/test", { actorEmail: "not-an-email" }),
      environment,
      { deliverEmail: vi.fn() },
    );
    expect(badPayload?.status).toBe(400);
  });

  it("uses global or existing delivery when there are no tenant settings", async () => {
    const fallback = vi.fn(async () => undefined);
    await sendAccountEmail(
      environment,
      { sendTransactionalEmail: fallback },
      { to: "person@example.test", subject: "Hello", text: "Test" },
      tenantId + 1,
    );
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("uses the built-in Cloudflare socket transport when the worker has no injected sender", async () => {
    await accountEmailSettingsResponse(
      request("PUT", "", settings),
      environment,
      {},
    );
    const email = { to: "person@example.test", subject: "Hello", text: "Test" };
    await sendAccountEmail(environment, {}, email, tenantId);
    expect(deliverSmtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        host: settings.host,
        security: settings.security,
      }),
      email,
    );
    const globalEnvironment = {
      ...environment,
      SAVIA_SMTP_HOST: "smtp.example.test",
      SAVIA_SMTP_PORT: "465",
      SAVIA_SMTP_FROM: "global@example.test",
      SAVIA_SMTP_USERNAME: "global-user",
      SAVIA_SMTP_PASSWORD: "global-secret",
    };
    await sendAccountEmail(globalEnvironment, {}, email);
    expect(deliverSmtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "global@example.test" }),
      email,
    );
  });
});
