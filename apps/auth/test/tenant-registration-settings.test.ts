import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAuthHandler } from "../src/index";

const environment = {
  ...env,
  BETTER_AUTH_SECRET: "registration-test-secret",
  SAVIA_INTERNAL_BRIDGE_KEY: "registration-bridge",
};
const tenantId = 712004;
const handler = createAuthHandler(environment, {
  sendTransactionalEmail: async () => undefined,
});
const request = (
  method: string,
  body?: unknown,
  id = tenantId,
  key = "registration-bridge",
  suffix = "",
) =>
  new Request(
    `https://auth.example.test/_internal/tenant-registration/${id}${suffix}`,
    {
      method,
      headers: {
        "x-savia-bridge-key": key,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
const base = {
  allowEmailRegistration: false,
  captchaMode: "tenant",
  siteKey: "site-key",
  secretKey: "private-captcha-secret",
};

describe("tenant registration settings", () => {
  it("defaults_registration_off and denies unauthenticated service callers", async () => {
    const response = await handler.fetch(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      allowEmailRegistration: false,
      captchaMode: "inherit",
      secretConfigured: false,
      emailReady: true,
    });
    expect(
      (await handler.fetch(request("GET", undefined, tenantId, "wrong")))
        .status,
    ).toBe(403);
  });
  it("preserves_hidden_secret_on_blank_save and encrypts_tenant_secret_with_tenant_binding", async () => {
    const saved = await handler.fetch(request("PUT", base));
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain(base.secretKey);
    const blank = await handler.fetch(
      request("PUT", {
        ...base,
        secretKey: "",
        allowEmailRegistration: true,
        captchaReady: true,
      }),
    );
    expect(blank.status).toBe(200);
    expect(await blank.json()).toMatchObject({
      secretConfigured: true,
      allowEmailRegistration: true,
    });
    const row = await environment.AUTH_DB.prepare(
      "SELECT ciphertext FROM tenant_registration_settings WHERE tenant_id=?",
    )
      .bind(tenantId)
      .first<{ ciphertext: string }>();
    expect(row?.ciphertext).not.toContain(base.secretKey);
    const effective = await handler.fetch(
      request("GET", undefined, tenantId, "registration-bridge", "/effective"),
    );
    expect(await effective.json()).toMatchObject({ secretKey: base.secretKey });
    await environment.AUTH_DB.prepare(
      "INSERT INTO tenant_registration_settings(tenant_id,ciphertext,revision,updated_at) VALUES(?,?,?,?)",
    )
      .bind(tenantId + 1, row!.ciphertext, "copy", new Date().toISOString())
      .run();
    expect(
      (await handler.fetch(request("GET", undefined, tenantId + 1))).status,
    ).toBe(503);
    expect(
      (
        await createAuthHandler({
          ...environment,
          BETTER_AUTH_SECRET: "rotated",
        }).fetch(request("GET"))
      ).status,
    ).toBe(503);
  });
  it("cannot_enable_with_missing_email_or_captcha and delete_resets_off", async () => {
    expect(
      (
        await handler.fetch(
          request("PUT", {
            ...base,
            allowEmailRegistration: true,
            captchaReady: false,
          }),
        )
      ).status,
    ).toBe(400);
    const noMail = createAuthHandler({
      ...environment,
      SAVIA_SMTP_HOST: undefined,
      SAVIA_SMTP_FROM: undefined,
    });
    expect(
      (
        await noMail.fetch(
          request("PUT", {
            ...base,
            allowEmailRegistration: true,
            captchaReady: true,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await handler.fetch(request("PUT", { ...base, secretKey: null })))
        .status,
    ).toBe(200);
    expect(await (await handler.fetch(request("GET"))).json()).toMatchObject({
      secretConfigured: false,
    });
    expect((await handler.fetch(request("DELETE"))).status).toBe(200);
    expect(await (await handler.fetch(request("GET"))).json()).toMatchObject({
      allowEmailRegistration: false,
      secretConfigured: false,
    });
  });
});

it("preserves accepted registration policy during CAPTCHA secret rotation", async () => {
  const first = await handler.fetch(
    request("PUT", {
      ...base,
      allowEmailRegistration: true,
      captchaReady: true,
    }),
  );
  const before = (await first.json()) as { revision: string };
  const second = await handler.fetch(
    request("PUT", {
      ...base,
      secretKey: "rotated-captcha-secret",
      allowEmailRegistration: true,
      captchaReady: true,
    }),
  );
  const after = (await second.json()) as { revision: string };
  expect(after.revision).toBe(before.revision);
  const disabled = await handler.fetch(
    request("PUT", { ...base, allowEmailRegistration: false }),
  );
  expect(((await disabled.json()) as { revision: string }).revision).not.toBe(
    before.revision,
  );
});
