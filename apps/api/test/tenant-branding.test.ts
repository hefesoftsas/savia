import { createTestApp } from "./test-app";
import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it, vi } from "vitest";
import { authenticationMiddleware } from "../src/auth/middleware";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import { registerTenantBrandingRoutes } from "../src/tenant-branding/routes";
import type { Authenticator } from "../src/auth/types";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, s]) => s);
beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((s) =>
        s
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});
let counter = 990000;
async function tenant() {
  const id = ++counter,
    slug = "brand-" + id,
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(id, slug, "Example agency", now, now)
    .run();
  return { id, slug };
}
function member(
  id: number,
  role = "tenant_admin",
  active = true,
): Authenticator {
  return {
    async authenticate() {
      const actor = await platformAdministratorAuthenticator().authenticate(
        new Request("https://test"),
        env.DB,
      );
      return {
        ...actor,
        globalRoles: [],
        memberships: [
          {
            id: "test",
            principalId: actor.principal.id,
            agencyId: id,
            tenantId: id,
            role,
            isActive: active,
            createdAt: "",
            updatedAt: "",
          },
        ],
      };
    },
  };
}
function app(
  auth: Authenticator = platformAdministratorAuthenticator(),
  bucket?: R2Bucket,
) {
  const instance = new OpenAPIHono();
  instance.use("/v1/*", authenticationMiddleware(env.DB, auth));
  registerTenantBrandingRoutes(instance, env.DB, bucket, "savia.test");
  return instance;
}
async function read(instance: ReturnType<typeof app>, id: number) {
  const response = await instance.request(
    "https://api.test/v1/tenants/" + id + "/branding",
  );
  expect(response.status).toBe(200);
  return (await response.json()) as any;
}
const put = (instance: ReturnType<typeof app>, id: number, data: unknown) =>
  instance.request("https://api.test/v1/tenants/" + id + "/branding", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
it("saves own tenant branding with optimistic concurrency and safe host projection", async () => {
  const t = await tenant(),
    instance = app(member(t.id));
  const initial = await read(instance, t.id);
  expect(initial.canManage).toBe(true);
  expect(initial.data.version).toBe(0);
  expect(initial.data.displayName).toBe("Example agency");
  const next = {
    ...initial.data,
    displayName: "Custom identity",
    loginTitle: "Welcome",
    primaryColor: "#123abc",
  };
  const writes = await Promise.all([
    put(instance, t.id, next),
    put(instance, t.id, { ...next, displayName: "Other" }),
  ]);
  expect(writes.map((r) => r.status).sort()).toEqual([200, 409]);
  const current = await read(instance, t.id);
  expect(current.data.version).toBe(1);
  const publicResponse = await instance.request(
    "https://" + t.slug + ".savia.test/api/public/tenant-branding",
  );
  expect(publicResponse.headers.get("cache-control")).toBe(
    "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  );
  expect(await publicResponse.json()).toEqual({ data: current.data });
  expect(
    await (
      await instance.request("https://savia.test/api/public/tenant-branding")
    ).json(),
  ).toEqual({ data: null });
});
it("blocks cross tenant, inactive memberships, viewers writes and inactive tenants", async () => {
  const a = await tenant(),
    b = await tenant();
  expect(
    (
      await app(member(a.id)).request(
        "https://api.test/v1/tenants/" + b.id + "/branding",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await app(member(a.id, "tenant_admin", false)).request(
        "https://api.test/v1/tenants/" + a.id + "/branding",
      )
    ).status,
  ).toBe(403);
  const viewer = app(member(a.id, "viewer")),
    config = await read(viewer, a.id);
  expect(config.canManage).toBe(false);
  expect((await put(viewer, a.id, config.data)).status).toBe(403);
  await env.DB.prepare("UPDATE tenants SET is_active=0 WHERE id=?")
    .bind(a.id)
    .run();
  expect(
    (await app().request("https://api.test/v1/tenants/" + a.id + "/branding"))
      .status,
  ).toBe(404);
  expect(
    await (
      await app().request(
        "https://" + a.slug + ".savia.test/api/public/tenant-branding",
      )
    ).json(),
  ).toEqual({ data: null });
});
it("rejects markup, unknown configuration and external image URLs", async () => {
  const t = await tenant(),
    instance = app(),
    { data } = await read(instance, t.id);
  for (const change of [
    { displayName: "<script>bad()</script>" },
    { customCss: "body{color:red}" },
    { primaryColor: "red;background:url(evil)" },
    { logoUrl: "https://evil.test/logo.png" },
    { coverUrl: "/api/public/tenant-branding/assets/1/not-owned" },
    { loginAnimationUrl: "https://evil.test/animation.json" },
  ])
    expect((await put(instance, t.id, { ...data, ...change })).status).toBe(
      400,
    );
});
const png = () =>
  Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=",
    ),
    (char) => char.charCodeAt(0),
  );
async function upload(
  instance: ReturnType<typeof app>,
  id: number,
  kind = "logo",
  bytes: Uint8Array = png(),
  type = "image/png",
) {
  const form = new FormData();
  form.set(
    "file",
    new File([bytes as Uint8Array<ArrayBuffer>], "untrusted-name.svg", {
      type,
    }),
  );
  return instance.request(
    "https://api.test/v1/tenants/" + id + "/branding/assets/" + kind,
    { method: "POST", body: form },
  );
}
it("stores validated images by tenant and only serves assets referenced by saved branding", async () => {
  const t = await tenant(),
    other = await tenant(),
    instance = app(member(t.id), env.DOCUMENTS);
  const response = await upload(instance, t.id);
  expect(response.status, await response.clone().text()).toBe(201);
  const {
    data: { url },
  } = (await response.json()) as any;
  expect(url).toMatch(
    new RegExp("^/api/public/tenant-branding/assets/" + t.id + "/"),
  );
  expect((await instance.request("https://api.test" + url)).status).toBe(404);
  const initial = await read(instance, t.id);
  expect(
    (await put(instance, t.id, { ...initial.data, logoUrl: url })).status,
  ).toBe(200);
  const image = await instance.request("https://api.test" + url);
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(image.headers.get("cache-control")).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(image.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(png());
  expect(
    (
      await instance.request(
        "https://api.test" +
          url.replace("/" + t.id + "/", "/" + other.id + "/"),
      )
    ).status,
  ).toBe(404);
  const foreign = await read(app(), other.id);
  expect(
    (await put(app(), other.id, { ...foreign.data, logoUrl: url })).status,
  ).toBe(400);
  const current = await read(instance, t.id);
  expect(
    (await put(instance, t.id, { ...current.data, logoUrl: null })).status,
  ).toBe(200);
  expect((await instance.request("https://api.test" + url)).status).toBe(404);
});
it("stores validated Lottie animations and only serves them when referenced by saved branding", async () => {
  const t = await tenant(),
    instance = app(member(t.id), env.DOCUMENTS);
  const animation = JSON.stringify({
    v: "5.7.0",
    fr: 60,
    ip: 0,
    op: 120,
    layers: [],
  });
  const uploadAnimation = (body: string, type = "application/json") => {
    const form = new FormData();
    form.set(
      "file",
      new File([body] as unknown as BlobPart[], "login.json", { type }),
    );
    return instance.request(
      "https://api.test/v1/tenants/" +
        t.id +
        "/branding/assets/login-animation",
      { method: "POST", body: form },
    );
  };
  for (const invalid of [
    "<svg></svg>",
    JSON.stringify({ v: "5.7.0", layers: [] }),
    JSON.stringify({ v: "5.7.0", fr: 60, ip: 0, op: 120, layers: {} }),
  ])
    expect(await (await uploadAnimation(invalid)).status).toBe(400);
  const response = await uploadAnimation(animation);
  expect(response.status, await response.clone().text()).toBe(201);
  const {
    data: { url },
  } = (await response.json()) as any;
  expect(url).toMatch(
    new RegExp("^/api/public/tenant-branding/assets/" + t.id + "/"),
  );
  expect((await instance.request("https://api.test" + url)).status).toBe(404);
  const initial = await read(instance, t.id);
  expect(initial.data.loginAnimationUrl).toBeNull();
  expect(
    (await put(instance, t.id, { ...initial.data, loginAnimationUrl: url }))
      .status,
  ).toBe(200);
  const served = await instance.request("https://api.test" + url);
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toContain("application/json");
  expect(served.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await served.json()).toEqual(JSON.parse(animation));
  const other = await tenant();
  const foreign = await read(app(), other.id);
  expect(
    (await put(app(), other.id, { ...foreign.data, loginAnimationUrl: url }))
      .status,
  ).toBe(400);
  const current = await read(instance, t.id);
  expect(
    (await put(instance, t.id, { ...current.data, loginAnimationUrl: null }))
      .status,
  ).toBe(200);
  expect((await instance.request("https://api.test" + url)).status).toBe(404);
});
it("lists the free MIT animation catalogue to authorized tenant viewers", async () => {
  const a = await tenant(),
    b = await tenant(),
    instance = app(member(a.id, "viewer"));
  const response = await instance.request(
    `https://api.test/v1/tenants/${a.id}/branding/animations?q=estrella`,
  );
  expect(response.status).toBe(200);
  const { data } = (await response.json()) as any;
  expect(data.length).toBeGreaterThan(0);
  expect(data.every((item: any) => item.license === "MIT")).toBe(true);
  expect(data.every((item: any) => item.author && item.licenseUrl)).toBe(true);
  expect(data.some((item: any) => item.id === "favorite-star")).toBe(true);
  expect(
    (
      await app(member(a.id)).request(
        `https://api.test/v1/tenants/${b.id}/branding/animations`,
      )
    ).status,
  ).toBe(403);
});
it("serves only pinned approved source JSON and embeds its MIT notice", async () => {
  const t = await tenant(),
    instance = app(member(t.id));
  const originalFetch = globalThis.fetch;
  const animation = JSON.stringify({
    v: "4.6.8",
    fr: 30,
    ip: 0,
    op: 51,
    w: 80,
    h: 80,
    assets: [],
    layers: [],
  });
  const upstream = vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe(
      "https://raw.githubusercontent.com/spemer/lottie-animations-json/d5bc5ecf1db13f1a051224b5c76f4d07756b57d8/ic_fav/ic_fav.json",
    );
    return new Response(animation, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  });
  vi.stubGlobal("fetch", upstream);
  const digest = vi
    .spyOn(globalThis.crypto.subtle, "digest")
    .mockImplementation(
      async () =>
        Uint8Array.from(
          "a11bf8c9cd305ddf3f1925be34d24966d8a1f68647c9f551cc3358f57ad6e82e"
            .match(/.{2}/g)!
            .map((byte) => Number.parseInt(byte, 16)),
        ).buffer,
    );
  try {
    const response = await instance.request(
      `https://api.test/v1/tenants/${t.id}/branding/animations/favorite-star`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.v).toBe("4.6.8");
    expect(body.saviaLicense).toMatchObject({
      license: "MIT",
      author: "Hyouk Seo",
    });
    expect(upstream).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    digest.mockRestore();
    globalThis.fetch = originalFetch;
  }
});
it("rejects redirected, oversized, and hash-mismatched catalogue sources", async () => {
  const t = await tenant(),
    instance = app(member(t.id));
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.test/animation.json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "Content-Length": String(2 * 1024 * 1024 + 1) },
      }),
    )
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  try {
    for (let index = 0; index < 3; index++) {
      const response = await instance.request(
        `https://api.test/v1/tenants/${t.id}/branding/animations/favorite-star`,
      );
      expect(response.status).toBe(502);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/spemer\/lottie-animations-json\/d5bc5ecf1db13f1a051224b5c76f4d07756b57d8\//,
      );
      expect(options?.redirect).toBe("manual");
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
it("imports a catalogue animation through the existing login-animation upload without saving branding", async () => {
  const t = await tenant(),
    instance = app(member(t.id), env.DOCUMENTS);
  const originalFetch = globalThis.fetch;
  const animation = JSON.stringify({
    v: "4.6.8",
    fr: 30,
    ip: 0,
    op: 51,
    w: 80,
    h: 80,
    assets: [],
    layers: [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(animation, { status: 200 })),
  );
  const digest = vi
    .spyOn(globalThis.crypto.subtle, "digest")
    .mockImplementation(
      async () =>
        Uint8Array.from(
          "a11bf8c9cd305ddf3f1925be34d24966d8a1f68647c9f551cc3358f57ad6e82e"
            .match(/.{2}/g)!
            .map((byte) => Number.parseInt(byte, 16)),
        ).buffer,
    );
  try {
    const response = await instance.request(
      `https://api.test/v1/tenants/${t.id}/branding/animations/favorite-star`,
      { method: "POST" },
    );
    expect(response.status, await response.clone().text()).toBe(201);
    const { data } = (await response.json()) as any;
    expect(data.url).toMatch(
      new RegExp(`^/api/public/tenant-branding/assets/${t.id}/`),
    );
    expect((await read(instance, t.id)).data.loginAnimationUrl).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT kind,content_type FROM tenant_branding_assets WHERE tenant_id=?",
      )
        .bind(t.id)
        .first(),
    ).toEqual({ kind: "login-animation", content_type: "application/json" });
  } finally {
    vi.unstubAllGlobals();
    digest.mockRestore();
    globalThis.fetch = originalFetch;
  }
});
it("requires tenant management before fetching a catalogue import and rejects unknown catalogue ids", async () => {
  const a = await tenant(),
    b = await tenant();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  try {
    const viewer = app(member(a.id, "viewer"));
    expect(
      (
        await viewer.request(
          `https://api.test/v1/tenants/${a.id}/branding/animations/favorite-star`,
          { method: "POST" },
        )
      ).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    const admin = app(member(a.id));
    expect(
      (
        await admin.request(
          `https://api.test/v1/tenants/${a.id}/branding/animations/not-approved`,
          { method: "POST" },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await admin.request(
          `https://api.test/v1/tenants/${a.id}/branding/animations/not-approved`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app(member(a.id)).request(
          `https://api.test/v1/tenants/${b.id}/branding/animations/favorite-star`,
          { method: "POST" },
        )
      ).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("rejects forged MIME, oversized files, wrong roles, and unsupported uploads", async () => {
  const t = await tenant(),
    instance = app(member(t.id), env.DOCUMENTS);
  expect(
    (
      await upload(
        instance,
        t.id,
        "logo",
        new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
        "image/png",
      )
    ).status,
  ).toBe(400);
  expect(
    (await upload(instance, t.id, "logo", new Uint8Array(2 * 1024 * 1024 + 1)))
      .status,
  ).toBe(413);
  expect(
    (await upload(app(member(t.id, "viewer"), env.DOCUMENTS), t.id)).status,
  ).toBe(403);
  expect((await upload(instance, t.id, "avatar")).status).toBe(400);
  expect((await upload(app(member(t.id)), t.id)).status).toBe(503);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM tenant_branding_assets WHERE tenant_id=?",
    )
      .bind(t.id)
      .first("n"),
  ).toBe(0);
});
it("caps concurrent image uploads and cleans only stale unpublished assets", async () => {
  const t = await tenant(),
    instance = app(member(t.id), env.DOCUMENTS);
  const uploaded = await upload(instance, t.id);
  const {
    data: { url },
  } = (await uploaded.json()) as any;
  const current = await read(instance, t.id);
  expect(
    (await put(instance, t.id, { ...current.data, logoUrl: url })).status,
  ).toBe(200);
  const now = new Date().toISOString(),
    seedIds = Array.from({ length: 18 }, () => crypto.randomUUID());
  await env.DB.batch(
    seedIds.map((id) =>
      env.DB.prepare(
        "INSERT INTO tenant_branding_assets(id,tenant_id,kind,object_key,content_type,size,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        t.id,
        "logo",
        "tenant-branding/" + t.id + "/" + id,
        "image/png",
        1,
        "test",
        now,
      ),
    ),
  );
  await env.DOCUMENTS.put("tenant-branding/" + t.id + "/" + seedIds[0], png());
  const responses = await Promise.all([
    upload(instance, t.id),
    upload(instance, t.id),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 429]);
  await env.DB.prepare(
    "UPDATE tenant_branding_assets SET created_at='2000-01-01T00:00:00.000Z' WHERE tenant_id=?",
  )
    .bind(t.id)
    .run();
  expect((await upload(instance, t.id)).status).toBe(201);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM tenant_branding_assets WHERE tenant_id=?",
    )
      .bind(t.id)
      .first("n"),
  ).toBe(2);
  expect(
    await env.DOCUMENTS.get("tenant-branding/" + t.id + "/" + seedIds[0]),
  ).toBe(null);
  expect((await instance.request("https://api.test" + url)).status).toBe(200);
});
it("allows own tenant administrators through the real API shell without exposing private configuration anonymously", async () => {
  const { AuthenticationError } = await import("../src/auth/types");
  const t = await tenant();
  const instance = createTestApp({
    auth: member(t.id),
    documents: env.DOCUMENTS,
  });
  const config = await read(instance, t.id);
  expect(config.canManage).toBe(true);
  expect(
    (await put(instance, t.id, { ...config.data, displayName: "My tenant" }))
      .status,
  ).toBe(200);
  const anonymous = createTestApp({
    auth: {
      async authenticate() {
        throw new AuthenticationError("AUTHENTICATION_REQUIRED", "Sign in");
      },
    },
  });
  const publicResponse = await anonymous.request(
    "https://" + t.slug + ".savia.app.hefesoft.com/api/public/tenant-branding",
  );
  expect(publicResponse.status).toBe(200);
  expect(((await publicResponse.json()) as any).data.displayName).toBe(
    "My tenant",
  );
  expect(
    (
      await anonymous.request(
        "https://api.test/v1/tenants/" + t.id + "/branding",
      )
    ).status,
  ).toBe(401);
});
it("ignores forged tenant slug headers on the canonical public host", async () => {
  const t = await tenant();
  const response = await app().request(
    "https://savia.test/api/public/tenant-branding",
    { headers: { "x-savia-tenant-slug": t.slug } },
  );
  expect(await response.json()).toEqual({ data: null });
});
it("retains cleanup tracking when R2 stores an upload but its acknowledgement fails", async () => {
  const t = await tenant();
  let stored = "";
  const ambiguous = {
    put: async (key: string, value: any, options: any) => {
      stored = key;
      await env.DOCUMENTS.put(key, value, options);
      throw Error("ack lost");
    },
    delete: env.DOCUMENTS.delete.bind(env.DOCUMENTS),
  } as unknown as R2Bucket;
  expect((await upload(app(member(t.id), ambiguous), t.id)).status).toBe(503);
  expect(
    await env.DB.prepare(
      "SELECT state FROM tenant_branding_assets WHERE tenant_id=?",
    )
      .bind(t.id)
      .first("state"),
  ).toBe("deleting");
  expect(await env.DOCUMENTS.get(stored)).not.toBe(null);
  expect((await upload(app(member(t.id), env.DOCUMENTS), t.id)).status).toBe(
    201,
  );
  expect(await env.DOCUMENTS.get(stored)).toBe(null);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM tenant_branding_assets WHERE tenant_id=?",
    )
      .bind(t.id)
      .first("n"),
  ).toBe(1);
});
it("preserves deletion tracking on cleanup failure and removes objects before deleting tenant rows", async () => {
  const { deleteTenantBrandingAssets } =
    await import("../src/tenant-branding/service");
  const t = await tenant();
  expect((await upload(app(member(t.id), env.DOCUMENTS), t.id)).status).toBe(
    201,
  );
  const key = await env.DB.prepare(
    "SELECT object_key FROM tenant_branding_assets WHERE tenant_id=?",
  )
    .bind(t.id)
    .first<string>("object_key");
  const failed = {
    delete: async () => {
      throw Error("offline");
    },
  } as unknown as R2Bucket;
  await expect(
    deleteTenantBrandingAssets(env.DB, failed, t.id),
  ).rejects.toThrow("Image cleanup failed");
  expect(
    await env.DB.prepare(
      "SELECT state FROM tenant_branding_assets WHERE tenant_id=?",
    )
      .bind(t.id)
      .first("state"),
  ).toBe("deleting");
  expect(
    await env.DB.prepare("SELECT is_active FROM tenants WHERE id=?")
      .bind(t.id)
      .first("is_active"),
  ).toBe(0);
  await deleteTenantBrandingAssets(env.DB, env.DOCUMENTS, t.id);
  expect(await env.DOCUMENTS.get(key!)).toBe(null);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM tenant_branding_assets WHERE tenant_id=?",
    )
      .bind(t.id)
      .first("n"),
  ).toBe(0);
});
it("blocks tenant deletion while an image upload is in flight", async () => {
  const { deleteTenantBrandingAssets } =
    await import("../src/tenant-branding/service");
  const t = await tenant();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO tenant_branding_assets(id,tenant_id,kind,object_key,state,content_type,size,created_by,created_at) VALUES(?,?,'logo',?,'uploading','image/png',1,'test',?)",
  )
    .bind(
      id,
      t.id,
      "tenant-branding/" + t.id + "/" + id,
      new Date().toISOString(),
    )
    .run();
  await expect(
    deleteTenantBrandingAssets(env.DB, env.DOCUMENTS, t.id),
  ).rejects.toThrow("upload is in progress");
  expect(
    await env.DB.prepare("SELECT is_active FROM tenants WHERE id=?")
      .bind(t.id)
      .first("is_active"),
  ).toBe(1);
});
it("keeps tenant active and published images intact when a CRM connection blocks deletion", async () => {
  const { upsertPrincipal } = await import("../src/auth/identity-repository");
  const t = await tenant(),
    instance = createTestApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
    });
  const image = await upload(instance, t.id);
  expect(image.status).toBe(201);
  const {
    data: { url },
  } = (await image.json()) as any;
  const initial = await read(instance, t.id);
  expect(
    (await put(instance, t.id, { ...initial.data, logoUrl: url })).status,
  ).toBe(200);
  const principal = await upsertPrincipal(env.DB, {
      issuer: "test",
      subject: crypto.randomUUID(),
      email: "branding-integration@example.test",
      displayName: "Tester",
    }),
    connection = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenant_crm_connections(id,tenant_id,created_by_principal_id,provider,nango_connection_id,nango_integration_id,status,created_at,updated_at) VALUES(?,?,?,'hubspot',?,?,'connected',?,?)",
  )
    .bind(connection, t.id, principal.id, connection, "test", now, now)
    .run();
  const response = await instance.request(
    "https://api.test/v1/tenants/" + t.id,
    { method: "DELETE" },
  );
  expect(response.status).toBe(409);
  expect(
    await env.DB.prepare("SELECT is_active FROM tenants WHERE id=?")
      .bind(t.id)
      .first("is_active"),
  ).toBe(1);
  expect((await instance.request("https://api.test" + url)).status).toBe(200);
  expect((await read(instance, t.id)).data.logoUrl).toBe(url);
});
it("deletes an eligible tenant and its published image through the API", async () => {
  const t = await tenant(),
    instance = createTestApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
    });
  const image = await upload(instance, t.id);
  const {
    data: { url },
  } = (await image.json()) as any;
  const initial = await read(instance, t.id);
  await put(instance, t.id, { ...initial.data, logoUrl: url });
  const key = await env.DB.prepare(
    "SELECT object_key FROM tenant_branding_assets WHERE tenant_id=?",
  )
    .bind(t.id)
    .first<string>("object_key");
  const response = await instance.request(
    "https://api.test/v1/tenants/" + t.id,
    { method: "DELETE" },
  );
  expect(response.status, await response.clone().text()).toBe(204);
  expect(
    await env.DB.prepare("SELECT id FROM tenants WHERE id=?")
      .bind(t.id)
      .first(),
  ).toBe(null);
  expect(await env.DOCUMENTS.get(key!)).toBe(null);
});

it("serves the same public branding through a legacy alias and stops serving inactive tenants", async () => {
  const row = await tenant();
  const alias = `old-${row.slug}`;
  await env.DB.prepare(
    "INSERT INTO tenant_slug_aliases(slug,tenant_id) VALUES(?,?)",
  )
    .bind(alias, row.id)
    .run();
  const instance = app();
  const canonical = await instance.request(
    `https://${row.slug}.savia.test/api/public/tenant-branding`,
  );
  const legacy = await instance.request(
    `https://${alias}.savia.test/api/public/tenant-branding`,
  );
  expect(legacy.status).toBe(200);
  expect(await legacy.json()).toEqual(await canonical.json());
  await env.DB.prepare("UPDATE tenants SET is_active=0 WHERE id=?")
    .bind(row.id)
    .run();
  const inactive = await instance.request(
    `https://${alias}.savia.test/api/public/tenant-branding`,
  );
  expect((await inactive.json()) as any).toEqual({ data: null });
});
