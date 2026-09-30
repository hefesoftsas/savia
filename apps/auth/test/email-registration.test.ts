import type { SMTPEmail } from "../src/smtp";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createAuthHandler, createBetterAuth } from "../src/index";

async function fixture(failMail = false, failFinalize = false) {
  const tenantId = 800000 + Math.floor(Math.random() * 100000);
  const email = `email-${crypto.randomUUID()}@example.test`;
  const deliver = vi.fn(async (_email: SMTPEmail) => {
    if (failMail) throw new Error("Mail unavailable");
  });
  const finalize = vi.fn(
    async (_request: Request) =>
      new Response(null, { status: failFinalize ? 503 : 201 }),
  );
  const environment = {
    ...env,
    SAVIA_API_RESOURCE: "https://savia.app.hefesoft.com",
    SAVIA_INTERNAL_BRIDGE_KEY: "email-test",
    SAVIA_IDENTITY: { fetch: finalize },
  };
  const handler = createAuthHandler(environment, {
    sendTransactionalEmail: deliver,
  });
  const request = (path: string, body?: unknown, key = "email-test") =>
    new Request(`http://127.0.0.1:8787${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-savia-bridge-key": key,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  await handler.fetch(
    new Request(
      `http://127.0.0.1:8787/_internal/tenant-registration/${tenantId}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-savia-bridge-key": "email-test",
        },
        body: JSON.stringify({
          allowEmailRegistration: true,
          captchaMode: "inherit",
          captchaReady: true,
        }),
      },
    ),
  );
  const settings = (await (
    await handler.fetch(request(`/_internal/tenant-registration/${tenantId}`))
  ).json()) as { revision: string };
  const body = {
    attemptId: crypto.randomUUID(),
    tenantId,
    name: "New Member",
    email,
    password: "long-password-1234",
    revision: settings.revision,
    origin: "http://team.127.0.0.1:8787",
  };
  // Use an allowed tenant host, distinct from the canonical host.
  body.origin = "https://team.savia.app.hefesoft.com";
  const context = await createBetterAuth(environment).$context;
  return {
    tenantId,
    email,
    deliver,
    finalize,
    environment,
    handler,
    request,
    body,
    context,
  };
}

describe("protected email registration", () => {
  it("requires bridge authorization and rejects client privilege fields", async () => {
    const f = await fixture();
    expect(
      (
        await f.handler.fetch(
          f.request("/_internal/email-registration/start", f.body, "wrong"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.handler.fetch(
          f.request("/_internal/email-registration/start", {
            ...f.body,
            role: "admin",
            emailVerified: true,
          }),
        )
      ).status,
    ).toBe(400);
    expect(await f.context.internalAdapter.findUserByEmail(f.email)).toBeNull();
  });
  it("creates an unverified fixed-role account once without membership or session", async () => {
    const f = await fixture();
    const response = await f.handler.fetch(
      f.request("/_internal/email-registration/start", f.body),
    );
    expect(response.status).toBe(200);
    const found = await f.context.internalAdapter.findUserByEmail(f.email);
    expect(found?.user).toMatchObject({
      emailVerified: false,
      role: "user",
      emailTenantId: f.tenantId,
    });
    expect(
      await f.context.internalAdapter.listSessions(found!.user.id),
    ).toEqual([]);
    expect(f.finalize).not.toHaveBeenCalled();
    expect(f.deliver).toHaveBeenCalledTimes(1);
    expect(
      (
        await f.handler.fetch(
          f.request("/_internal/email-registration/start", f.body),
        )
      ).status,
    ).toBe(200);
    expect(f.deliver).toHaveBeenCalledTimes(1);
    expect(
      (
        await f.handler.fetch(
          f.request("/_internal/email-registration/start", {
            ...f.body,
            password: "changed-password-123",
          }),
        )
      ).status,
    ).toBe(409);
  });
  it("keeps existing addresses generic and compensates an owned account after mail failure", async () => {
    const f = await fixture(true);
    expect(
      (
        await f.handler.fetch(
          f.request("/_internal/email-registration/start", f.body),
        )
      ).status,
    ).toBe(503);
    expect(await f.context.internalAdapter.findUserByEmail(f.email)).toBeNull();
    await f.context.adapter.create({
      model: "user",
      data: {
        email: f.email,
        name: "Existing",
        emailVerified: true,
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    expect(
      (
        await f.handler.fetch(
          f.request("/_internal/email-registration/start", {
            ...f.body,
            attemptId: crypto.randomUUID(),
          }),
        )
      ).status,
    ).toBe(200);
    expect(f.deliver).toHaveBeenCalledTimes(1);
    expect(
      (await f.context.internalAdapter.findUserByEmail(f.email))?.user.role,
    ).toBe("admin");
  });
  it("finalizes only after verification and rechecks registration policy before issuing a session", async () => {
    const f = await fixture();
    await f.handler.fetch(
      f.request("/_internal/email-registration/start", f.body),
    );
    const login = () =>
      f.handler.fetch(
        new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:8787",
          },
          body: JSON.stringify({ email: f.email, password: f.body.password }),
        }),
      );
    expect((await login()).status).toBe(403);
    expect(f.finalize).not.toHaveBeenCalled();
    const found = await f.context.internalAdapter.findUserByEmail(f.email);
    const message = f.deliver.mock.calls[0][0].text;
    const verificationUrl = new URL(
      message.match(/https?:\/\/[^\s]+token=[^\s]+/)![0],
    );
    verificationUrl.searchParams.delete("callbackURL");
    const verified = await f.handler.fetch(new Request(verificationUrl));
    expect(verified.ok).toBe(true);
    expect(verified.headers.get("set-cookie")).toBeNull();
    const response = await login();
    expect(response.status).toBe(200);
    expect(f.finalize).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        (f.finalize.mock.calls[0] as unknown as [Request])[0].body
          ? await (f.finalize.mock.calls[0] as unknown as [Request])[0].text()
          : "{}",
      ),
    ).toMatchObject({ tenantId: f.tenantId, subject: found!.user.id });
  });
  it("leaves no session on quota failure or changed registration policy", async () => {
    const f = await fixture(false, true);
    await f.handler.fetch(
      f.request("/_internal/email-registration/start", f.body),
    );
    const found = await f.context.internalAdapter.findUserByEmail(f.email);
    await f.context.adapter.update({
      model: "user",
      where: [{ field: "id", value: found!.user.id }],
      update: { emailVerified: true },
    });
    const response = await f.handler.fetch(
      new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:8787",
        },
        body: JSON.stringify({ email: f.email, password: f.body.password }),
      }),
    );
    expect(response.ok).toBe(false);
    expect(
      await f.context.internalAdapter.listSessions(found!.user.id),
    ).toEqual([]);
  });
});

it("exposes registration only for a ready trusted tenant login", async () => {
  const f = await fixture();
  const headers = {
    "x-savia-bridge-key": "email-test",
    "x-savia-tenant-email-id": String(f.tenantId),
    "x-savia-registration-ready": "true",
  };
  const path = "https://team.savia.app.hefesoft.com/api/auth/login";
  expect(
    await (await f.handler.fetch(new Request(path, { headers }))).text(),
  ).toContain('href="/register"');
  expect(
    await (
      await f.handler.fetch(
        new Request(path, {
          headers: { ...headers, "x-savia-bridge-key": "wrong" },
        }),
      )
    ).text(),
  ).not.toContain('href="/register"');
  expect(
    await (
      await f.handler.fetch(
        new Request("http://127.0.0.1:8787/api/auth/login", { headers }),
      )
    ).text(),
  ).not.toContain('href="/register"');
});

it("preserves verified pending accounts after cleanup and permits a late first login", async () => {
  const f = await fixture();
  await f.handler.fetch(
    f.request("/_internal/email-registration/start", f.body),
  );
  const found = await f.context.internalAdapter.findUserByEmail(f.email);
  await f.context.adapter.update({
    model: "user",
    where: [{ field: "id", value: found!.user.id }],
    update: { emailVerified: true },
  });
  await f.environment.AUTH_DB.prepare(
    "UPDATE pending_password_registration SET expires_at=? WHERE id=?",
  )
    .bind(Date.now() - 1, f.body.attemptId)
    .run();
  const { cleanupPasswordRegistrations } =
    await import("../src/email-registration");
  await cleanupPasswordRegistrations(f.environment);
  const login = await f.handler.fetch(
    new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:8787",
      },
      body: JSON.stringify({ email: f.email, password: f.body.password }),
    }),
  );
  expect(login.status).toBe(200);
  expect(f.finalize).toHaveBeenCalledTimes(1);
});

it("bounds native verification resends by server-owned tenant and address", async () => {
  const f = await fixture();
  await f.handler.fetch(
    f.request("/_internal/email-registration/start", f.body),
  );
  const completions: Promise<unknown>[] = [];
  const execution = {
    waitUntil: (promise: Promise<unknown>) => completions.push(promise),
  } as unknown as ExecutionContext;
  for (let i = 0; i < 5; i++) {
    const sent = await f.handler.fetch(
      new Request("http://127.0.0.1:8787/api/auth/send-verification-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:8787",
        },
        body: JSON.stringify({ email: f.email }),
      }),
      execution,
    );
    expect(sent.status).toBe(200);
    await Promise.all(completions);
  }
  expect(f.deliver).toHaveBeenCalledTimes(5);
});
