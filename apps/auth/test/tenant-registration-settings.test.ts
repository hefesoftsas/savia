import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAuthHandler } from "../src/index";
import { initializeAccountEmailSchema } from "../src/account-email";
import { tenantRegistrationSettingsResponse } from "../src/tenant-registration-settings";
import { initializeTenantRegistrationSettingsSchema } from "../src/tenant-registration-settings";
import type { TenantSSOAdapter } from "../src/tenant-sso";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("runs effective registration preflight reads concurrently", async () => {
  const preflightEnvironment = {
    ...environment,
    SAVIA_AUTH_DEPLOYMENT_REVISION: "6".repeat(40),
  };
  await initializeAccountEmailSchema(preflightEnvironment);
  await initializeTenantRegistrationSettingsSchema(preflightEnvironment);

  const databaseGate = deferred<void>();
  const databaseReads: string[] = [];
  const database = new Proxy(preflightEnvironment.AUTH_DB, {
    get(target, property) {
      if (property === "prepare")
        return (query: string) => {
          const sql = String(query);
          const prepared = target.prepare(query);
          const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
            new Proxy(statement, {
              get(statementTarget, statementProperty) {
                if (statementProperty === "bind")
                  return (...values: unknown[]) =>
                    wrap(statementTarget.bind(...values));
                if (statementProperty === "first")
                  return async (...args: unknown[]) => {
                    if (
                      /FROM (tenant_registration_settings|tenant_email_settings)/i.test(
                        sql,
                      )
                    ) {
                      databaseReads.push(sql);
                      await databaseGate.promise;
                    }
                    return statementTarget.first(...args);
                  };
                const value = Reflect.get(
                  statementTarget,
                  statementProperty,
                  statementTarget,
                );
                return typeof value === "function"
                  ? value.bind(statementTarget)
                  : value;
              },
            });
          return wrap(prepared);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const activeGate = deferred<{ active: boolean } | null>();
  const providerGate = deferred<{ saviaSSOOnly?: boolean } | null>();
  const policyReads: string[] = [];
  const adapter = {
    async findOne({ model }: { model: string }) {
      policyReads.push(model);
      return model === "tenantAuthState"
        ? activeGate.promise
        : providerGate.promise;
    },
  } as unknown as TenantSSOAdapter;
  const responsePromise = tenantRegistrationSettingsResponse(
    new Request(
      `https://auth.example.test/_internal/tenant-registration/${tenantId + 1000}/effective`,
      { headers: { "x-savia-bridge-key": "registration-bridge" } },
    ),
    { ...preflightEnvironment, AUTH_DB: database },
    {},
    adapter,
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  const allReadsStarted =
    databaseReads.length === 2 &&
    policyReads.includes("tenantAuthState") &&
    policyReads.includes("ssoProvider");
  databaseGate.resolve();
  activeGate.resolve({ active: true });
  providerGate.resolve(null);
  const response = await responsePromise;

  expect(allReadsStarted).toBe(true);
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({
    emailReady: false,
    passwordAllowed: true,
  });
});

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
