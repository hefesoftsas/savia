import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createBetterAuth, createAuthHandler } from "../src/index";
import {
  beginMicrosoftVerification,
  provenMicrosoftIdentity,
} from "../src/microsoft-email-verification";
import { runWithEndpointContext } from "@better-auth/core/context";
const environment = {
  ...env,
  BETTER_AUTH_SECRET: "microsoft-verification-secret",
  SAVIA_INTERNAL_BRIDGE_KEY: "microsoft-proof-bridge",
  SAVIA_MICROSOFT_CLIENT_ID: "test-client",
  SAVIA_MICROSOFT_CLIENT_SECRET: "test-secret",
};
const handler = createAuthHandler(environment, {
  sendTransactionalEmail: async () => undefined,
});
const auth = createBetterAuth(environment, {
  sendTransactionalEmail: async () => undefined,
});
const adapter = (await auth.$context).adapter;
async function policy() {
  await handler.fetch(
    new Request("http://localhost/_internal/tenant-social/723004", {
      method: "PUT",
      headers: {
        "x-savia-bridge-key": "microsoft-proof-bridge",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        googleEnabled: false,
        microsoftEnabled: true,
        microsoftTenantId: "2262a239-cb6f-4cef-bce2-faf78ea0b5de",
        allowMicrosoftPersonalAccounts: true,
        allowRegistration: false,
      }),
    }),
  );
  return await adapter.findOne<any>({
    model: "tenantSocialSettings",
    where: [{ field: "tenantId", value: 723004 }],
  });
}
const consumer = {
  tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
  oid: "consumer-subject",
  email: "member@example.test",
  name: "Member",
};
describe("Microsoft email verification", () => {
  it("holds an unverified genuine consumer profile without creating users or sessions when registration is off", async () => {
    const settings = await policy();
    const pending = await beginMicrosoftVerification(
      consumer,
      {
        attemptId: crypto.randomUUID(),
        tenantId: 723004,
        provider: "microsoft",
        revision: settings.revision,
        returnOrigin: "https://team.example.test",
        expiresAt: Date.now() + 600000,
      },
      "original-browser-nonce",
      environment,
      adapter,
    );
    expect(pending).toMatchObject({
      purpose: "microsoft_link",
      providerSubject: "consumer-subject",
      email: "member@example.test",
    });
    expect(
      await adapter.findOne({
        model: "user",
        where: [{ field: "email", value: "member@example.test" }],
      }),
    ).toBeNull();
    expect(
      await provenMicrosoftIdentity(consumer, 723004, environment, adapter),
    ).toBeNull();
  });
  it("rejects stale policy revisions, foreign organization profiles, and disabled personal accounts", async () => {
    const settings = await policy();
    const attempt = {
      attemptId: crypto.randomUUID(),
      tenantId: 723004,
      provider: "microsoft" as const,
      revision: "stale",
      returnOrigin: "https://team.example.test",
      expiresAt: Date.now() + 600000,
    };
    await expect(
      beginMicrosoftVerification(
        consumer,
        attempt,
        "original-browser-nonce",
        environment,
        adapter,
      ),
    ).rejects.toThrow();
    await expect(
      beginMicrosoftVerification(
        { ...consumer, tid: "foreign" },
        { ...attempt, revision: settings.revision },
        "original-browser-nonce",
        environment,
        adapter,
      ),
    ).rejects.toThrow();
  });
  it("rejects forged id tokens before reaching email ownership verification", async () => {
    await policy();
    const context = await auth.$context;
    const provider = context.socialProviders.find((p) => p.id === "microsoft")!;
    await expect(
      runWithEndpointContext({ context }, () =>
        provider.getUserInfo({
          idToken: "forged-token",
          expectedIdTokenNonce: "nonce",
        }),
      ),
    ).rejects.toThrow();
  });
});

it("validates a signed consumer callback and opens the original-browser email flow with no account or session", async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { vi } = await import("vitest");
  const settings = await policy();
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-consumer-key",
    alg: "RS256",
    use: "sig",
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/common/discovery/v2.0/keys"))
      return Response.json({ keys: [jwk] });
    throw new Error("Unexpected external request");
  });
  try {
    const context = await auth.$context;
    const provider = context.socialProviders.find((p) => p.id === "microsoft")!;
    const start = await auth.handler(
      new Request(`${environment.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          origin: environment.BETTER_AUTH_URL,
          "content-type": "application/json",
          "x-savia-bridge-key": "microsoft-proof-bridge",
          "x-savia-social-tenant-id": "723004",
        },
        body: JSON.stringify({
          provider: "microsoft",
          callbackURL: `${environment.BETTER_AUTH_URL}/api/auth/sso-complete`,
          disableRedirect: true,
        }),
      }),
    );
    expect(start.status).toBe(200);
    const authorization = new URL(
      ((await start.json()) as { url: string }).url,
    );
    expect(authorization.searchParams.get("nonce")).toBeTruthy();
    const token = await new SignJWT({
      ...consumer,
      email: "callback-owner@example.test",
      nonce: authorization.searchParams.get("nonce"),
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-consumer-key" })
      .setIssuer(`https://login.microsoftonline.com/${consumer.tid}/v2.0`)
      .setAudience("test-client")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    provider.validateAuthorizationCode = async () => ({ idToken: token });
    const cookie = start.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const callback = await auth.handler(
      new Request(
        `${environment.BETTER_AUTH_URL}/api/auth/callback/microsoft?code=real-shaped-fixture&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
        { headers: { cookie } },
      ),
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain(
      "/api/auth/microsoft-email-verification?id=",
    );
    expect(
      callback.headers
        .getSetCookie()
        .some(
          (c) =>
            c.includes("microsoft_email_verification") &&
            c.includes("HttpOnly"),
        ),
    ).toBe(true);
    expect(
      callback.headers.getSetCookie().some((c) => c.includes("session_token=")),
    ).toBe(false);
    expect(
      await adapter.findOne({
        model: "user",
        where: [{ field: "email", value: "callback-owner@example.test" }],
      }),
    ).toBeNull();
    const location = callback.headers.get("location")!;
    const nonceCookie = callback.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const page = await handler.fetch(
      new Request(location, { headers: { cookie: nonceCookie } }),
    );
    expect(await page.text()).toContain("Verifica tu correo");
    const wrongBrowser = await handler.fetch(new Request(location));
    expect(await wrongBrowser.text()).toContain("navegador donde comenzaste");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("binds a precreated verified member without creating another user and keeps their email after provider changes", async () => {
  const { completeMicrosoftVerification } =
    await import("../src/microsoft-email-verification");
  const { sendPendingVerification, consumePendingVerification } =
    await import("../src/pending-email-verification");
  const settings = await policy();
  const user = await adapter.create<Record<string, unknown>, any>({
    model: "user",
    data: {
      email: "precreated@example.test",
      emailVerified: true,
      emailTenantId: 723004,
      role: "user",
      name: "Precreated",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const profile = {
    ...consumer,
    oid: crypto.randomUUID(),
    email: "precreated@example.test",
  };
  const pending = await beginMicrosoftVerification(
    profile,
    {
      attemptId: crypto.randomUUID(),
      tenantId: 723004,
      provider: "microsoft",
      revision: settings.revision,
      returnOrigin: "https://team.example.test",
      expiresAt: Date.now() + 600000,
    },
    "original-browser-nonce",
    environment,
    adapter,
  );
  let url = "";
  await sendPendingVerification(
    {
      id: pending.id,
      browserNonce: "original-browser-nonce",
      origin: "https://team.example.test",
    },
    environment,
    {
      sendTransactionalEmail: async (mail) => {
        url = mail.text.match(/https:\/\/[^\s]+/)![0];
      },
    },
  );
  await consumePendingVerification(
    {
      id: pending.id,
      token: new URL(url).searchParams.get("token")!,
      browserNonce: "original-browser-nonce",
      origin: "https://team.example.test",
      purpose: "microsoft_link",
      tenantId: 723004,
    },
    environment,
  );
  const linkedEnv = {
    ...environment,
    SAVIA_IDENTITY: {
      fetch: async (req: Request) => {
        expect(new URL(req.url).pathname).toBe(
          "/_internal/social-registration/eligible",
        );
        return Response.json({ eligible: true });
      },
    },
  };
  await completeMicrosoftVerification(pending, linkedEnv, adapter);
  expect(
    await provenMicrosoftIdentity(
      { ...profile, email: "changed@provider.example" },
      723004,
      environment,
      adapter,
    ),
  ).toMatchObject({
    id: user.id,
    email: "precreated@example.test",
    emailVerified: true,
  });
  await expect(
    provenMicrosoftIdentity(profile, 723005, environment, adapter),
  ).rejects.toThrow();
  await adapter.update({
    model: "user",
    where: [{ field: "id", value: user.id }],
    update: { role: "admin" },
  });
  await expect(
    provenMicrosoftIdentity(profile, 723004, environment, adapter),
  ).rejects.toThrow();
});

it("does not turn local registration or an unconsumed mail intent into Microsoft account creation", async () => {
  const { completeMicrosoftVerification } =
    await import("../src/microsoft-email-verification");
  const { sendPendingVerification, consumePendingVerification } =
    await import("../src/pending-email-verification");
  const settings = await policy();
  const email = `missing-${crypto.randomUUID()}@example.test`;
  const pending = await beginMicrosoftVerification(
    { ...consumer, oid: crypto.randomUUID(), email },
    {
      attemptId: crypto.randomUUID(),
      tenantId: 723004,
      provider: "microsoft",
      revision: settings.revision,
      returnOrigin: "https://team.example.test",
      expiresAt: Date.now() + 600000,
    },
    "original-browser-nonce",
    environment,
    adapter,
  );
  await expect(
    completeMicrosoftVerification(pending, environment, adapter),
  ).rejects.toThrow();
  let url = "";
  await sendPendingVerification(
    {
      id: pending.id,
      browserNonce: "original-browser-nonce",
      origin: "https://team.example.test",
    },
    environment,
    {
      sendTransactionalEmail: async (mail) => {
        url = mail.text.match(/https:\/\/[^\s]+/)![0];
      },
    },
  );
  await consumePendingVerification(
    {
      id: pending.id,
      token: new URL(url).searchParams.get("token")!,
      browserNonce: "original-browser-nonce",
      origin: "https://team.example.test",
      purpose: "microsoft_link",
      tenantId: 723004,
    },
    environment,
  );
  await expect(
    completeMicrosoftVerification(
      pending,
      {
        ...environment,
        SAVIA_IDENTITY: { fetch: async () => Response.json({ ok: true }) },
      },
      adapter,
    ),
  ).rejects.toThrow();
  expect(
    await adapter.findOne({
      model: "user",
      where: [{ field: "email", value: email }],
    }),
  ).toBeNull();
});

it("creates only a user role after both proofs and retains recoverable failed provisioning", async () => {
  const { completeMicrosoftVerification } =
    await import("../src/microsoft-email-verification");
  const { sendPendingVerification, consumePendingVerification } =
    await import("../src/pending-email-verification");
  const settings = await policy();
  await adapter.update({
    model: "tenantSocialSettings",
    where: [{ field: "tenantId", value: 723004 }],
    update: { allowRegistration: true },
  });
  const email = `opted-in-${crypto.randomUUID()}@example.test`;
  const pending = await beginMicrosoftVerification(
    { ...consumer, oid: crypto.randomUUID(), email },
    {
      attemptId: crypto.randomUUID(),
      tenantId: 723004,
      provider: "microsoft",
      revision: settings.revision,
      returnOrigin: "https://team.example.test",
      expiresAt: Date.now() + 600000,
    },
    "original-browser-nonce",
    environment,
    adapter,
  );
  let url = "";
  await sendPendingVerification(
    {
      id: pending.id,
      browserNonce: "original-browser-nonce",
      origin: "https://team.example.test",
    },
    environment,
    {
      sendTransactionalEmail: async (mail) => {
        url = mail.text.match(/https:\/\/[^\s]+/)![0];
      },
    },
  );
  await consumePendingVerification(
    {
      id: pending.id,
      token: new URL(url).searchParams.get("token")!,
      browserNonce: "original-browser-nonce",
      origin: "https://team.example.test",
      purpose: "microsoft_link",
      tenantId: 723004,
    },
    environment,
  );
  await expect(
    completeMicrosoftVerification(
      pending,
      {
        ...environment,
        SAVIA_IDENTITY: {
          fetch: async (req: Request) =>
            req.method === "DELETE"
              ? Response.json({ removed: true })
              : new Response(null, { status: 503 }),
        },
      },
      adapter,
    ),
  ).rejects.toThrow();
  expect(
    await adapter.findOne({
      model: "user",
      where: [{ field: "email", value: email }],
    }),
  ).toMatchObject({ role: "user", emailVerified: true });
  // A fresh proved attempt succeeds with the fixed minimum-auth role.
  const pending2 = { ...pending, id: crypto.randomUUID() };
  await environment.AUTH_DB.prepare(
    "INSERT INTO pending_email_verification(id,value,expires_at,consumed_at) VALUES(?,?,?,?)",
  )
    .bind(
      pending2.id,
      JSON.stringify(pending2),
      Date.now() + 600000,
      Date.now(),
    )
    .run();
  await completeMicrosoftVerification(
    pending2,
    {
      ...environment,
      SAVIA_IDENTITY: {
        fetch: async (req: Request) => {
          const body = (await req.json()) as Record<string, unknown>;
          expect(body).toMatchObject({
            tenantId: 723004,
            email,
            provider: "microsoft",
            revision: settings.revision,
          });
          expect(body).not.toHaveProperty("role");
          return Response.json({ created: true });
        },
      },
    },
    adapter,
  );
  expect(
    await adapter.findOne({
      model: "user",
      where: [{ field: "email", value: email }],
    }),
  ).toMatchObject({ role: "user", emailVerified: true, emailTenantId: 723004 });
});

it("recovers an owned unbound account without deleting concurrent administrator edits", async () => {
  const { completeMicrosoftVerification } =
    await import("../src/microsoft-email-verification");
  const { sendPendingVerification, consumePendingVerification } =
    await import("../src/pending-email-verification");
  const settings = await policy();
  await adapter.update({
    model: "tenantSocialSettings",
    where: [{ field: "tenantId", value: 723004 }],
    update: { allowRegistration: true },
  });
  const email = `recover-${crypto.randomUUID()}@example.test`;
  const subject = crypto.randomUUID();
  async function proof() {
    const pending = await beginMicrosoftVerification(
      { ...consumer, oid: subject, email },
      {
        attemptId: crypto.randomUUID(),
        tenantId: 723004,
        provider: "microsoft",
        revision: settings.revision,
        returnOrigin: "https://team.example.test",
        expiresAt: Date.now() + 600000,
      },
      "recovery-browser",
      environment,
      adapter,
    );
    let link = "";
    await sendPendingVerification(
      {
        id: pending.id,
        browserNonce: "recovery-browser",
        origin: "https://team.example.test",
      },
      environment,
      {
        sendTransactionalEmail: async (mail) => {
          link = mail.text.match(/https:\/\/[^\s]+/)![0];
        },
      },
    );
    await consumePendingVerification(
      {
        id: pending.id,
        token: new URL(link).searchParams.get("token")!,
        browserNonce: "recovery-browser",
        origin: "https://team.example.test",
        purpose: "microsoft_link",
        tenantId: 723004,
      },
      environment,
    );
    return pending;
  }
  const first = await proof();
  await expect(
    completeMicrosoftVerification(
      first,
      {
        ...environment,
        SAVIA_IDENTITY: {
          fetch: async () => {
            throw new Error("Bridge unavailable");
          },
        },
      },
      adapter,
    ),
  ).rejects.toThrow();
  expect(
    await adapter.findOne({
      model: "user",
      where: [{ field: "email", value: email }],
    }),
  ).toBeTruthy();
  const second = await proof();
  const paths: string[] = [];
  await completeMicrosoftVerification(
    second,
    {
      ...environment,
      SAVIA_IDENTITY: {
        fetch: async (request) => {
          paths.push(new URL(request.url).pathname);
          expect(request.method).toBe("POST");
          const body = (await request.json()) as { attemptId: string };
          expect(body.attemptId).toBe(first.id);
          await adapter.update({
            model: "user",
            where: [{ field: "id", value: `ms-${first.id}` }],
            update: { name: "Administrator renamed user" },
          });
          return new Response(null, {
            status: new URL(request.url).pathname.endsWith("/eligible")
              ? 403
              : 201,
          });
        },
      },
    },
    adapter,
  );
  expect(paths).not.toContain(`/_internal/social-registration/${first.id}`);
  expect(
    await adapter.findOne({
      model: "user",
      where: [{ field: "email", value: email }],
    }),
  ).toMatchObject({ id: `ms-${first.id}`, name: "Administrator renamed user" });
  expect(paths).not.toContain("/_internal/social-registration/eligible");
  expect(
    await provenMicrosoftIdentity(
      { ...consumer, oid: subject, email },
      723004,
      environment,
      adapter,
    ),
  ).toMatchObject({ email });
});
