import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
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
it("verifies captchas with worker-supported fetch options", async () => {
  const instance = app();
  const link = await publish(instance, await object());
  const calls = verify.mock.calls.length;
  const response = await submit(instance, link, { name: "Visitor" });
  expect(response.status).toBe(200);
  const init = verify.mock.calls[calls][1] as RequestInit;
  // The Workers runtime only supports "follow"/"manual": "error" throws
  // TypeError and breaks every anonymous submission.
  expect(init.redirect ?? "follow").not.toBe("error");
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
it("hard-deletes only dead links and refuses active ones", async () => {
  const instance = app();
  const name = await object();
  const link = await publish(instance, name);
  const remove = (id: string, hard: boolean) =>
    instance.request(
      `https://api.test/v1/public-forms/${id}${hard ? "?hard=true" : ""}`,
      { method: "DELETE" },
    );
  expect((await remove(link.id, true)).status).toBe(409);
  expect((await submit(instance, link, { name: "Still alive" })).status).toBe(
    200,
  );
  expect((await remove(link.id, false)).status).toBe(200);
  expect((await submit(instance, link, { name: "Revoked" })).status).toBe(404);
  expect((await remove(link.id, true)).status).toBe(200);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM public_forms WHERE id=?")
      .bind(link.id)
      .first("n"),
  ).toBe(0);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM public_form_submissions WHERE form_id=?",
    )
      .bind(link.id)
      .first("n"),
  ).toBe(0);
  expect((await remove(link.id, true)).status).toBe(200);
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
it("returns the public insurance quote presentation", async () => {
  const frozenSnapshot = {
    version: 1,
    publicationId: crypto.randomUUID(),
    tenant: "domain:demo",
    domainId: "demo",
    objectName: "cotizador_por_pasos",
    extensionId: "insurance.quotes",
    extensionVersion: "1.2.0",
    actionId: "quote",
    mode: "live",
    connectionId: "simulation",
    settingsVersion: 1,
    products: [{ flowId: "sbs-producto-8" }],
  };
  const presentation = {
    renderer: "insurance-quote-wizard",
    entry: "wizard",
    products: [{ flowId: "sbs-producto-8", label: "SBS · Autos Producto 8" }],
  };
  const presentationFor = vi.fn(async () => presentation);
  const quote = {
    publish: async () => ({
      fields: [
        { name: "name", label: "Name", type: "text" as const, required: true },
      ],
      snapshot: frozenSnapshot,
    }),
    validate: async ({ values }: any) => values,
    execute: async () => undefined,
    assertAvailable: async () => {},
    presentation: presentationFor,
  };
  const instance = app({ quote });
  const name = await object();
  const link = await publish(instance, name, {
    kind: "quote",
    returnResult: false,
  });
  const response = await instance.request(
    "https://api.test/api/public/forms/" + link.token,
  );
  expect(response.status).toBe(200);
  const definition = (await response.json()) as any;
  expect(definition.presentation).toEqual(presentation);
  expect(presentationFor).toHaveBeenCalledWith({
    objectName: expect.any(String),
    snapshot: expect.objectContaining({ products: expect.any(Array) }),
  });
  const serialized = JSON.stringify(definition);
  expect(serialized).not.toMatch(
    /snapshot|tenant_id|tenantId|extensionVersion|actionId|connectionId|providerPayload/,
  );
  expect(definition).not.toHaveProperty("snapshot");
  // Record links remain generic.
  const recordInstance = app();
  const recordName = await object();
  const recordLink = await publish(recordInstance, recordName);
  const recordDefinition = (await (
    await recordInstance.request(
      "https://api.test/api/public/forms/" + recordLink.token,
    )
  ).json()) as any;
  expect(recordDefinition).not.toHaveProperty("presentation");
});
it("skips captcha verification for the local development bypass", async () => {
  const instance = app({
    disableCaptcha: true,
    publicOrigin: "http://127.0.0.1:5173",
    siteKey: undefined,
    secretKey: undefined,
  });
  const name = await object();
  const link = await publish(instance, name);
  const calls = verify.mock.calls.length;
  const definition = (await (
    await instance.request("https://api.test/api/public/forms/" + link.token)
  ).json()) as any;
  expect(definition.captchaProvider).toBe("disabled");
  expect(definition).not.toHaveProperty("siteKey");
  const response = await submit(instance, link, { name: "Local" });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true });
  expect(verify.mock.calls.length).toBe(calls);
});
it("ignores the bypass flag outside localhost origins", async () => {
  const instance = app({
    disableCaptcha: true,
    siteKey: undefined,
    secretKey: undefined,
  });
  const name = await object();
  const response = await instance.request("https://api.test/v1/public-forms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      domainId: "demo",
      objectName: name,
      kind: "record",
    }),
  });
  expect(response.status).toBe(503);
});
it("serves the public plate lookup only for quote links with a lookup adapter", async () => {
  const lookupVehicle = vi.fn(async () => ({
    plate: "TESTCAR",
    fasecoldaCode: "12345678",
    productionYear: 2023,
  }));
  const quote = {
    publish: async () => ({
      fields: [
        { name: "name", label: "Name", type: "text" as const, required: true },
      ],
      snapshot: { frozen: "policy" },
    }),
    validate: async ({ values }: any) => values,
    execute: async () => undefined,
    assertAvailable: async () => {},
    lookupVehicle,
  };
  const instance = app({ quote });
  const name = await object();
  const link = await publish(instance, name, { kind: "quote" });
  const found = await instance.request(
    "https://api.test/api/public/forms/" + link.token + "/vehicle-lookup",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plate: "testcar" }),
    },
  );
  expect(found.status).toBe(200);
  expect(await found.json()).toEqual({
    plate: "TESTCAR",
    fasecoldaCode: "12345678",
    productionYear: 2023,
  });
  expect(lookupVehicle).toHaveBeenCalledWith(
    expect.objectContaining({
      objectName: expect.any(String),
      plate: "testcar",
    }),
  );
  const recordLink = await publish(app(), await object());
  expect(
    (
      await app({ quote }).request(
        "https://api.test/api/public/forms/" +
          recordLink.token +
          "/vehicle-lookup",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plate: "TESTCAR" }),
        },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await app().request(
        "https://api.test/api/public/forms/" + link.token + "/vehicle-lookup",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plate: "TESTCAR" }),
        },
      )
    ).status,
  ).toBe(503);
});
it("serves bounded city suggestions for quote links without upstream internals", async () => {
  const upstream = vi.fn(async () =>
    Response.json({
      status: "ok",
      matches: Array.from({ length: 25 }, (_, index) => ({
        code: `11${String(index).padStart(3, "0")}`,
        city: `Ciudad ${index}`,
        department: "Departamento",
        internalScore: index,
        secret: "never-public",
      })),
    }),
  );
  const quote = {
    publish: async () => ({
      fields: [
        { name: "name", label: "Name", type: "text" as const, required: true },
      ],
      snapshot: { frozen: "policy" },
    }),
    validate: async ({ values }: any) => values,
    execute: async () => undefined,
  };
  const instance = app({
    quote,
    saviaRequest: { fetch: upstream as unknown as typeof fetch },
  });
  const link = await publish(instance, await object(), { kind: "quote" });
  const found = await instance.request(
    "https://api.test/api/public/forms/" + link.token + "/cities?search=bog",
  );
  expect(found.status).toBe(200);
  const body = (await found.json()) as any;
  expect(body.matches).toHaveLength(20);
  expect(body.matches[0]).toEqual({
    code: expect.any(String),
    city: expect.any(String),
    department: expect.any(String),
  });
  expect(JSON.stringify(body)).not.toMatch(/secret|internalScore/);
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(String(upstream.mock.calls[0][0].url)).toContain(
    "/api/lookups/dane?city=bog",
  );
  const recordLink = await publish(app(), await object());
  expect(
    (
      await instance.request(
        "https://api.test/api/public/forms/" +
          recordLink.token +
          "/cities?search=bog",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await instance.request(
        "https://api.test/api/public/forms/" + link.token + "/cities?search=x",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app({ quote }).request(
        "https://api.test/api/public/forms/" +
          link.token +
          "/cities?search=bog",
      )
    ).status,
  ).toBe(503);
});
it("serves per-product quote progress for a known submission only", async () => {
  const quoteStatus = vi.fn(async () => ({
    items: [
      {
        flowId: "flow-a",
        label: "Insurer A · Product A",
        insurer: "Insurer A",
        status: "quoting",
      },
    ],
  }));
  const quote = {
    publish: async () => ({
      fields: [
        { name: "name", label: "Name", type: "text" as const, required: true },
      ],
      snapshot: { frozen: "policy" },
    }),
    validate: async ({ values }: any) => values,
    execute: async () => undefined,
    quoteStatus,
  };
  const instance = app({ quote });
  const link = await publish(instance, await object(), { kind: "quote" });
  const submissionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO public_form_submissions(form_id,submission_id,tenant_id,ip_hash,day,fingerprint,captcha_hash,state,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      link.id,
      submissionId,
      "domain:demo",
      "iphash",
      new Date().toISOString().slice(0, 10),
      "fingerprint",
      "captchahash",
      "reserved",
      new Date().toISOString(),
    )
    .run();
  const found = await instance.request(
    "https://api.test/api/public/forms/" +
      link.token +
      "/status/" +
      submissionId,
  );
  expect(found.status).toBe(200);
  expect(await found.json()).toEqual({
    items: [
      {
        flowId: "flow-a",
        label: "Insurer A · Product A",
        insurer: "Insurer A",
        status: "quoting",
      },
    ],
  });
  expect(quoteStatus).toHaveBeenCalledWith(
    expect.objectContaining({ submission: submissionId }),
  );
  // Unknown submissions 404 without revealing link state.
  expect(
    (
      await instance.request(
        "https://api.test/api/public/forms/" +
          link.token +
          "/status/" +
          crypto.randomUUID(),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await instance.request(
        "https://api.test/api/public/forms/" +
          link.token +
          "/status/not-a-uuid",
      )
    ).status,
  ).toBe(400);
  // Record links never serve quote progress.
  const recordLink = await publish(app(), await object());
  expect(
    (
      await instance.request(
        "https://api.test/api/public/forms/" +
          recordLink.token +
          "/status/" +
          submissionId,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await app().request(
        "https://api.test/api/public/forms/" +
          link.token +
          "/status/" +
          submissionId,
      )
    ).status,
  ).toBe(404);
});
it("preserves safe provider failures instead of masking them as 503", async () => {
  const execute = vi.fn(async () => {
    throw new HTTPException(502, {
      message: "No se pudo completar la cotización. Intenta más tarde.",
    });
  });
  const quote = {
    publish: async () => ({
      fields: [
        { name: "name", label: "Name", type: "text" as const, required: true },
      ],
      snapshot: { frozen: "policy" },
    }),
    validate: async ({ values }: any) => values,
    execute,
  };
  const instance = app({ quote });
  const link = await publish(instance, await object(), {
    kind: "quote",
    returnResult: true,
  });
  const response = await submit(instance, link, { name: "One" });
  expect(response.status).toBe(502);
  expect(await response.text()).toContain("cotización");
  expect(execute).toHaveBeenCalledTimes(1);
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

const altchaSecret = "savia-test-altcha-secret-at-least-32-characters";
const selfHostedOptions = {
  captchaProvider: "altcha" as const,
  altchaSecret,
  siteKey: undefined,
  secretKey: undefined,
  rateLimiter: { limit: async () => ({ success: true }) },
};
it("publishes a self-hosted form and issues a private, expiring form-bound challenge without Turnstile", async () => {
  const instance = app(selfHostedOptions);
  const link = await publish(instance, await object());
  verify.mockClear();
  const definition = await instance.request("/api/public/forms/" + link.token);
  expect(definition.status).toBe(200);
  expect(await definition.json()).toMatchObject({ captchaProvider: "altcha" });
  const response = await instance.request(
    "/api/public/forms/" + link.token + "/challenge",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const challenge = (await response.json()) as any;
  expect(challenge.parameters.data.formId).toBe(link.id);
  expect(challenge.parameters.expiresAt).toBeGreaterThan(Date.now() / 1000);
  expect(challenge.parameters.expiresAt).toBeLessThanOrEqual(
    Date.now() / 1000 + 300,
  );
  expect(challenge.signature).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(challenge)).not.toContain(altchaSecret);
  const { solveChallenge } = await import("altcha-lib");
  const { deriveKey } = await import("altcha-lib/algorithms/pbkdf2");
  const solution = await solveChallenge({ challenge, deriveKey });
  expect(solution).not.toBeNull();
  const submitted = await submit(
    instance,
    link,
    { name: "Issued challenge" },
    crypto.randomUUID(),
    encodeProof({ challenge, solution }),
  );
  expect(submitted.status, await submitted.clone().text()).toBe(200);
  expect(verify).not.toHaveBeenCalled();
});

async function selfHostedProof(
  formId: string,
  expiresAt = new Date(Date.now() + 300_000),
) {
  const { createChallenge, solveChallenge } = await import("altcha-lib");
  const { deriveKey } = await import("altcha-lib/algorithms/pbkdf2");
  const challenge = await createChallenge({
    algorithm: "PBKDF2/SHA-256",
    cost: 1000,
    counter: 1,
    deriveKey,
    hmacSignatureSecret: altchaSecret,
    expiresAt,
    data: {
      formId,
      origin: "https://forms.savia.test",
      action: "public_submit",
    },
  });
  const solution = await solveChallenge({ challenge, deriveKey });
  expect(solution).not.toBeNull();
  return { challenge, solution: solution! };
}
const encodeProof = (proof: unknown) => btoa(JSON.stringify(proof));
it("verifies self-hosted proof, preserves exact idempotent retries and rejects reencoded replay with a different submission", async () => {
  const instance = app(selfHostedOptions);
  const name = await object();
  const link = await publish(instance, name);
  const proof = await selfHostedProof(link.id);
  const token = encodeProof(proof),
    id = crypto.randomUUID();
  verify.mockClear();
  const first = await submit(
    instance,
    link,
    { name: "Self hosted" },
    id,
    token,
  );
  expect(first.status, await first.clone().text()).toBe(200);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600_000);
  try {
    const retry = await submit(
      instance,
      link,
      { name: "Self hosted" },
      id,
      token,
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await first.json());
  } finally {
    clock.mockRestore();
  }
  const unsolved = structuredClone(proof);
  unsolved.solution.derivedKey = "0".repeat(64);
  expect(
    (
      await submit(
        instance,
        link,
        { name: "Self hosted" },
        id,
        encodeProof(unsolved),
      )
    ).status,
  ).toBe(409);
  const reencoded = btoa(
    JSON.stringify(
      { solution: { ...proof.solution, time: 10 }, challenge: proof.challenge },
      null,
      1,
    ),
  );
  const replay = await submit(
    instance,
    link,
    { name: "Replay" },
    crypto.randomUUID(),
    reencoded,
  );
  expect(replay.status).toBe(429);
  const count = await env.DB.prepare(
    "SELECT count(*) AS n FROM crm_records WHERE object_name=?",
  )
    .bind(name)
    .first<{ n: number }>();
  expect(count?.n).toBe(1);
  expect(verify).not.toHaveBeenCalled();
});
it("rejects expired, wrong-form, tampered and unsolved self-hosted challenges before reserving a write", async () => {
  const instance = app(selfHostedOptions);
  const name = await object(),
    link = await publish(instance, name);
  const proofs = [
    await selfHostedProof(link.id, new Date(Date.now() - 1000)),
    await selfHostedProof(crypto.randomUUID()),
    await selfHostedProof(link.id),
    await selfHostedProof(link.id),
    await selfHostedProof(link.id),
  ];
  proofs[4].challenge.parameters.data!.origin =
    "https://other-installation.test";
  proofs[2].challenge.parameters.expiresAt! += 60;
  proofs[3].solution.derivedKey = "0".repeat(64);
  for (const proof of proofs) {
    const result = await submit(
      instance,
      link,
      { name: "Rejected" },
      crypto.randomUUID(),
      encodeProof(proof),
    );
    expect(result.status, await result.clone().text()).toBe(403);
  }
  expect(
    (
      await env.DB.prepare(
        "SELECT count(*) AS n FROM public_form_submissions WHERE form_id=?",
      )
        .bind(link.id)
        .first<{ n: number }>()
    )?.n,
  ).toBe(0);
});
it("fails closed for missing self-hosted secrets or rate limiter and limits challenge issuance", async () => {
  const working = app(selfHostedOptions),
    link = await publish(working, await object());
  for (const options of [
    { altchaSecret: undefined },
    { altchaSecret: "short" },
    { rateLimiter: undefined },
  ]) {
    const response = await app({ ...selfHostedOptions, ...options }).request(
      "/api/public/forms/" + link.token,
    );
    expect(response.status).toBe(503);
  }
  const limited = app({
    ...selfHostedOptions,
    rateLimiter: { limit: async () => ({ success: false }) },
  });
  expect(
    (await limited.request("/api/public/forms/" + link.token + "/challenge"))
      .status,
  ).toBe(429);
  expect(
    (await working.request("/api/public/forms/" + link.token + "/records"))
      .status,
  ).toBe(404);
  expect(
    (
      await working.request("/api/public/forms/" + link.token + "/challenge", {
        method: "DELETE",
      })
    ).status,
  ).toBe(405);
});
