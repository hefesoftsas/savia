import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it, vi } from "vitest";
import { makeConfig } from "@savia/crm-shared/metadata";
import { authenticationMiddleware } from "../src/auth/middleware";
import {
  platformAdministratorAuthenticator,
  agencyMemberAuthenticator,
} from "./auth-fixtures";
import {
  registerPublicFormRoutes,
  type PublicFormsOptions,
} from "../src/public-forms/routes";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);
beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((v) =>
        v
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});
let captchaLink = "";
const verify = vi.fn(async (_url: unknown, init?: RequestInit) =>
  Response.json({
    success: true,
    hostname: "forms.savia.test",
    action: "public_submit",
    cdata: captchaLink,
  }),
);
function app(options: Partial<PublicFormsOptions> = {}, admin = true) {
  const app = new OpenAPIHono();
  app.use(
    "/v1/*",
    authenticationMiddleware(
      env.DB,
      admin
        ? platformAdministratorAuthenticator()
        : agencyMemberAuthenticator(),
    ),
  );
  registerPublicFormRoutes(app, env.DB, {
    siteKey: "configured-site-key",
    secretKey: "configured-secret-key",
    publicOrigin: "https://forms.savia.test",
    fetch: verify as typeof fetch,
    ...options,
  });
  return app;
}
async function object(
  fields: Record<string, unknown> = {
    name: { type: "Textbox", label: "Name", required: true },
  },
  domain = "demo",
) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO crm_data_domains(id,label,created_by) VALUES(?,?,?)",
  )
    .bind(domain, domain, "test")
    .run();
  const name = "form_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  await env.DB.prepare(
    "INSERT INTO crm_objects(tenant_id,name,label,description,config) VALUES(?,?,?,?,?)",
  )
    .bind(
      "domain:" + domain,
      name,
      "Public title",
      "Public description",
      JSON.stringify(makeConfig(fields as never)),
    )
    .run();
  return name;
}
async function publish(
  instance: ReturnType<typeof app>,
  objectName: string,
  extra = {},
) {
  const response = await instance.request("https://api.test/v1/public-forms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      domainId: "demo",
      objectName,
      kind: "record",
      ...extra,
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const { data } = (await response.json()) as any;
  captchaLink = data.id;
  return data;
}
const submit = (
  instance: ReturnType<typeof app>,
  link: any,
  values: unknown,
  id = crypto.randomUUID(),
  token = "captcha-" + crypto.randomUUID(),
) =>
  instance.request("https://api.test/api/public/forms/" + link.token, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "192.0.2." + Math.floor(Math.random() * 200),
    },
    body: JSON.stringify({ submissionId: id, token, values }),
  });
it("publishes a safe immutable definition and creates only the server-selected collection", async () => {
  const instance = app();
  const name = await object({
    name: { type: "Textbox", label: "Name", required: true },
    private_token: {
      type: "Textbox",
      label: "SECRET LABEL",
      hidden: true,
      config: { defaultValue: "SECRET" },
    },
    related: {
      type: "Dropdown",
      label: "Private lookup",
      config: { relation: "contact" },
    },
  });
  const link = await publish(instance, name);
  const definition = (await (
    await instance.request("https://api.test/api/public/forms/" + link.token)
  ).json()) as any;
  expect(definition.fields).toEqual([
    { name: "name", label: "Name", type: "text", required: true },
  ]);
  expect(JSON.stringify(definition)).not.toMatch(
    /SECRET|private_token|related|"config"/,
  );
  const response = await submit(instance, link, { name: "Visitor" });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true });
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM crm_records WHERE tenant_id=? AND object_name=?",
    )
      .bind("domain:demo", name)
      .first("n"),
  ).toBe(1);
  expect(
    (
      await submit(instance, link, {
        name: "Other",
        tenant_id: "domain:private",
      })
    ).status,
  ).toBe(422);
});
it("requires administrator management and blocks anonymous methods, expired links and revoked links", async () => {
  const instance = app();
  const name = await object();
  const link = await publish(instance, name);
  expect(
    (
      await app({}, false).request(
        "https://api.test/v1/public-forms?domainId=demo&objectName=" + name,
      )
    ).status,
  ).toBe(403);
  for (const method of ["PUT", "PATCH", "DELETE", "HEAD"])
    expect(
      (
        await instance.request(
          "https://api.test/api/public/forms/" + link.token,
          { method },
        )
      ).status,
    ).toBe(405);
  expect(
    (
      await instance.request("https://api.test/v1/public-forms/" + link.id, {
        method: "DELETE",
      })
    ).status,
  ).toBe(200);
  expect((await submit(instance, link, { name: "Visitor" })).status).toBe(404);
});
it("atomically caps concurrent submissions and replays only the original proof without duplicate writes", async () => {
  const instance = app();
  const name = await object();
  const link = await publish(instance, name, { dailyLimit: 1 });
  const id = crypto.randomUUID(),
    proof = "captcha-" + crypto.randomUUID();
  const responses = await Promise.all([
    submit(instance, link, { name: "One" }, id, proof),
    submit(instance, link, { name: "Two" }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 429]);
  const winning = responses[0].status === 200;
  if (winning) {
    expect(
      (await submit(instance, link, { name: "One" }, id, proof)).status,
    ).toBe(200);
    expect(
      (await submit(instance, link, { name: "One" }, id, "other-proof")).status,
    ).toBe(409);
  }
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM crm_records WHERE tenant_id=? AND object_name=?",
    )
      .bind("domain:demo", name)
      .first("n"),
  ).toBe(1);
});
it("fails closed for missing captcha configuration and incorrect challenge binding", async () => {
  const instance = app();
  const name = await object();
  const link = await publish(instance, name);
  expect(
    (await submit(app({ secretKey: undefined }), link, { name: "One" })).status,
  ).toBe(503);
  for (const mismatch of [
    { hostname: "evil.test" },
    { action: "login" },
    { cdata: "other-form" },
    { success: false },
  ]) {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        hostname: "forms.savia.test",
        action: "public_submit",
        cdata: link.id,
        ...mismatch,
      }),
    );
    expect(
      (
        await submit(app({ fetch: fetcher as typeof fetch }), link, {
          name: "One",
        })
      ).status,
    ).toBe(403);
  }
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM public_form_submissions WHERE form_id=?",
    )
      .bind(link.id)
      .first("n"),
  ).toBe(0);
});
it("keeps fields frozen, rejects required private fields, expired links, and foreign domain publication", async () => {
  const instance = app();
  const name = await object();
  const link = await publish(instance, name);
  await env.DB.prepare(
    "UPDATE crm_objects SET config=? WHERE tenant_id=? AND name=?",
  )
    .bind(
      JSON.stringify(
        makeConfig({
          name: { type: "Textbox", label: "Changed" },
          extra: { type: "Textbox", label: "New private field" },
        }),
      ),
      "domain:demo",
      name,
    )
    .run();
  const definition = (await (
    await instance.request("https://api.test/api/public/forms/" + link.token)
  ).json()) as any;
  expect(definition.fields).toHaveLength(1);
  expect(definition.fields[0].label).toBe("Name");
  expect(
    (await submit(instance, link, { name: "One", extra: "no" })).status,
  ).toBe(422);
  await env.DB.prepare(
    "UPDATE public_forms SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
  )
    .bind(link.id)
    .run();
  expect((await submit(instance, link, { name: "One" })).status).toBe(404);
  const privateName = await object({
    password: { type: "Textbox", label: "Password", required: true },
  });
  const request = (objectName: string, domainId = "demo") =>
    instance.request("https://api.test/v1/public-forms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domainId, objectName, kind: "record" }),
    });
  expect((await request(privateName)).status).toBe(422);
  expect((await request(name, "foreign")).status).toBe(404);
});
it("limits request bodies and early bursts without invoking captcha", async () => {
  const instance = app();
  const name = await object();
  const link = await publish(instance, name);
  const calls = verify.mock.calls.length;
  expect(
    (await submit(instance, link, { name: "x".repeat(40000) })).status,
  ).toBe(413);
  const limit = vi.fn(async () => ({ success: false }));
  expect(
    (await submit(app({ rateLimiter: { limit } }), link, { name: "One" }))
      .status,
  ).toBe(429);
  expect(limit).toHaveBeenCalledWith({
    key: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(verify.mock.calls.length).toBe(calls);
});
it("executes a quote only once and sanitizes failure responses", async () => {
  const execute = vi.fn(async () => {
    throw Error("PRIVATE provider password and payload");
  });
  const quote = {
    publish: async () => ({
      fields: [
        { name: "name", label: "Name", type: "text" as const, required: true },
      ],
      snapshot: { private: "never public" },
    }),
    validate: async ({ values }: any) => values,
    execute,
  };
  const instance = app({ quote });
  const name = await object();
  const link = await publish(instance, name, {
    kind: "quote",
    returnResult: true,
  });
  const id = crypto.randomUUID(),
    proof = "captcha-" + crypto.randomUUID();
  const response = await submit(instance, link, { name: "One" }, id, proof);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(
    (await submit(instance, link, { name: "One" }, id, proof)).status,
  ).toBe(409);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(
    (
      await instance.request(
        "https://api.test/api/public/forms/" + link.token + "/results",
      )
    ).status,
  ).toBe(404);
});
it("applies IP and tenant quotas durably even without the optional rate limiter", async () => {
  const instance = app();
  const name = await object();
  const link = await publish(instance, name, { dailyLimit: 1000 });
  const now = new Date().toISOString(),
    day = now.slice(0, 10);
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("configured-secret-key:192.0.2.1"),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  await env.DB.batch(
    Array.from({ length: 20 }, () =>
      env.DB.prepare(
        "INSERT INTO public_form_submissions(form_id,submission_id,tenant_id,ip_hash,day,fingerprint,captcha_hash,state,created_at) VALUES(?,?,?,?,?,?,?,'failed',?)",
      ).bind(
        link.id,
        crypto.randomUUID(),
        "domain:demo",
        hash,
        day,
        "fingerprint",
        crypto.randomUUID(),
        now,
      ),
    ),
  );
  const response = await instance.request(
    "https://api.test/api/public/forms/" + link.token,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "192.0.2.1",
      },
      body: JSON.stringify({
        submissionId: crypto.randomUUID(),
        token: "fresh-proof",
        values: { name: "One" },
      }),
    },
  );
  expect(response.status).toBe(429);
  await env.DB.prepare(
    "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000) INSERT INTO public_form_submissions(form_id,submission_id,tenant_id,ip_hash,day,fingerprint,captcha_hash,state,created_at) SELECT ?, 'seed-'||n, ?, 'different-ip', ?, 'fingerprint', 'seed-'||n||?, 'failed', ? FROM seq",
  )
    .bind(link.id, "domain:demo", day, link.id, now)
    .run();
  const otherLink = await publish(instance, name, { dailyLimit: 1000 });
  expect((await submit(instance, otherLink, { name: "One" })).status).toBe(429);
  await env.DB.prepare("DELETE FROM public_form_submissions WHERE form_id=?")
    .bind(link.id)
    .run();
});
it("rejects dummy captcha keys and unavailable verification without reserving submissions", async () => {
  const instance = app();
  const name = await object();
  const link = await publish(instance, name);
  for (const options of [
    { siteKey: "1x00000000000000000000AA" },
    { secretKey: "1x0000000000000000000000000000000AA" },
    {
      fetch: (async () => {
        throw new DOMException("timeout", "TimeoutError");
      }) as typeof fetch,
    },
  ]) {
    expect((await submit(app(options), link, { name: "One" })).status).toBe(
      503,
    );
  }
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM public_form_submissions WHERE form_id=?",
    )
      .bind(link.id)
      .first("n"),
  ).toBe(0);
});
it("returns only opted-in safe quote results and coalesces simultaneous duplicate supplier submissions", async () => {
  const execute = vi.fn(async () => ({ status: "quoted", amount: 123 }));
  const quote = {
    publish: async () => ({
      fields: [
        { name: "name", label: "Name", type: "text" as const, required: true },
      ],
      snapshot: { private: "never public" },
    }),
    validate: async ({ values }: any) => values,
    execute,
  };
  const instance = app({ quote });
  const name = await object();
  const link = await publish(instance, name, {
    kind: "quote",
    returnResult: true,
  });
  expect(link.url).toBe("https://forms.savia.test/public/forms/" + link.token);
  const id = crypto.randomUUID(),
    proof = "captcha-" + crypto.randomUUID();
  const responses = await Promise.all([
    submit(instance, link, { name: "One" }, id, proof),
    submit(instance, link, { name: "One" }, id, proof),
  ]);
  expect(responses.some((response) => response.status === 200)).toBe(true);
  expect(
    responses.every((response) => [200, 409].includes(response.status)),
  ).toBe(true);
  const retry = await submit(instance, link, { name: "One" }, id, proof);
  expect(await retry.json()).toEqual({
    ok: true,
    reference: id,
    result: { status: "quoted", amount: 123 },
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(
    (await submit(instance, link, { name: "One" }, crypto.randomUUID(), proof))
      .status,
  ).toBe(429);
  const privateResultLink = await publish(instance, name, {
    kind: "quote",
    returnResult: false,
  });
  const privateResponse = await submit(instance, privateResultLink, {
    name: "Two",
  });
  expect((await privateResponse.json()) as any).not.toHaveProperty("result");
});
it("closes links when their domain disappears and rejects metadata-only remote collections", async () => {
  const instance = app();
  const name = await object(undefined, "retired");
  const link = await publish(instance, name, { domainId: "retired" });
  await env.DB.prepare("DELETE FROM crm_data_domains WHERE id=?")
    .bind("retired")
    .run();
  expect((await submit(instance, link, { name: "One" })).status).toBe(404);
  const remote = await object();
  const config = makeConfig({ name: { type: "Textbox", label: "Name" } });
  config.studio = { business: "customer" };
  await env.DB.prepare(
    "UPDATE crm_objects SET config=? WHERE tenant_id=? AND name=?",
  )
    .bind(JSON.stringify(config), "domain:demo", remote)
    .run();
  const response = await instance.request("https://api.test/v1/public-forms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      domainId: "demo",
      objectName: remote,
      kind: "record",
    }),
  });
  expect(response.status).toBe(422);
});
it("integrates anonymous submissions with the real API shell while private routes still require authentication", async () => {
  const { createTestApp } = await import("./test-app");
  const { AuthenticationError } = await import("../src/auth/types");
  const options = {
    siteKey: "configured-site-key",
    secretKey: "configured-secret-key",
    publicOrigin: "https://forms.savia.test",
    fetch: verify as typeof fetch,
  };
  const admin = createTestApp({
    auth: platformAdministratorAuthenticator(),
    publicForms: options,
  });
  const name = await object();
  const link = await publish(admin, name);
  const authenticate = vi.fn(async () => {
    throw new AuthenticationError("AUTHENTICATION_REQUIRED", "Sign in");
  });
  const anonymous = createTestApp({
    auth: { authenticate },
    publicForms: options,
  });
  const definition = await anonymous.request(
    "https://api.test/api/public/forms/" + link.token,
  );
  expect(definition.status).toBe(200);
  expect(definition.headers.get("cache-control")).toBe("no-store");
  expect((await submit(anonymous, link, { name: "Visitor" })).status).toBe(200);
  expect(authenticate).not.toHaveBeenCalled();
  expect(
    (
      await anonymous.request(
        "https://api.test/v1/public-forms?domainId=demo&objectName=" + name,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await anonymous.request(
        "https://api.test/v1/data-domains/demo/api/records/" + name,
      )
    ).status,
  ).toBe(401);
});
it("binds tenant links to active commercial tenants and closes them after deactivation", async () => {
  const instance = app();
  const name = await object();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(880012, "public-form-tenant", "Form tenant", 1, now, now)
    .run();
  await env.DB.prepare(
    "UPDATE crm_objects SET tenant_id=? WHERE tenant_id=? AND name=?",
  )
    .bind("agency:880012", "domain:demo", name)
    .run();
  const link = await publish(instance, name, { domainId: "tenant:880012" });
  expect(
    (await submit(instance, link, { name: "Tenant visitor" })).status,
  ).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM crm_records WHERE tenant_id=? AND object_name=?",
    )
      .bind("agency:880012", name)
      .first("n"),
  ).toBe(1);
  await env.DB.prepare("UPDATE tenants SET is_active=0 WHERE id=?")
    .bind(880012)
    .run();
  expect((await submit(instance, link, { name: "Blocked" })).status).toBe(404);
  expect(
    (await instance.request("https://api.test/api/public/forms/" + link.token))
      .status,
  ).toBe(404);
});
it("excludes conditional section fields and rejects required fields in those sections", async () => {
  const instance = app();
  const name = await object();
  const config = makeConfig({
    name: { type: "Textbox", label: "Name" },
    conditional: {
      type: "Textbox",
      label: "Conditional private label",
      config: { section: "internal" },
    },
  });
  config.studio = {
    sections: [
      {
        id: "internal",
        label: "Internal",
        visibleWhen: { field: "name", op: "eq", value: "staff" },
      },
    ],
  };
  await env.DB.prepare(
    "UPDATE crm_objects SET config=? WHERE tenant_id=? AND name=?",
  )
    .bind(JSON.stringify(config), "domain:demo", name)
    .run();
  const link = await publish(instance, name);
  const definition = (await (
    await instance.request("https://api.test/api/public/forms/" + link.token)
  ).json()) as any;
  expect(definition.fields.map((field: any) => field.name)).toEqual(["name"]);
  expect(
    (await submit(instance, link, { name: "Visitor", conditional: "injected" }))
      .status,
  ).toBe(422);
  config.fields.conditional.required = true;
  await env.DB.prepare(
    "UPDATE crm_objects SET config=? WHERE tenant_id=? AND name=?",
  )
    .bind(JSON.stringify(config), "domain:demo", name)
    .run();
  const rejected = await instance.request("https://api.test/v1/public-forms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      domainId: "demo",
      objectName: name,
      kind: "record",
    }),
  });
  expect(rejected.status).toBe(422);
});
