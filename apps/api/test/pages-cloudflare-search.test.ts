import { createTestApp } from "./test-app";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
import {
  grantMembership,
  loadActor,
  upsertPrincipal,
} from "../src/auth/identity-repository";
import {
  CloudflarePagesSearch,
  type PagesSearchBindings,
} from "../src/pages/cloudflare-search";
import { PagesService } from "../src/pages/service";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
});
let sequence = 986500;
async function fixture() {
  const tenantId = ++sequence;
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(?,?,?,'commercial',1,'2026-10-02','2026-10-02')",
  )
    .bind(tenantId, `cloudflare-${tenantId}`, `Cloudflare ${tenantId}`)
    .run();
  const key = crypto.randomUUID();
  const principal = await upsertPrincipal(env.DB, {
    issuer: "savia:test",
    subject: key,
    email: `${key}@test.example`,
    displayName: "Owner",
  });
  await grantMembership(env.DB, principal.id, tenantId, "viewer");
  const actor = await loadActor(env.DB, principal);
  const pages = new PagesService(env.DB, actor);
  const page = await pages.create({ title: "Shared knowledge" });
  const bindings = {
    AI: {
      run: vi.fn(async (_model: string, input: { text: string[] }) => ({
        data: input.text.map(() => Array(1024).fill(0.5)),
      })),
    },
    PAGES_VECTORIZE: {
      upsert: vi.fn(async () => ({})),
      query: vi.fn(async () => ({
        matches: [] as {
          id: string;
          score: number;
          metadata?: Record<string, unknown>;
        }[],
      })),
      deleteByIds: vi.fn(async () => ({})),
    },
  } satisfies PagesSearchBindings;
  return {
    tenantId,
    actor,
    pages,
    page,
    bindings,
    search: new CloudflarePagesSearch(env.DB, actor, bindings),
  };
}
async function enable(tenantId: number) {
  await env.DB.prepare(
    "INSERT INTO tenant_pages_search_settings(tenant_id,allowed,enabled,updated_at) VALUES(?,1,1,?)",
  )
    .bind(tenantId, new Date().toISOString())
    .run();
}
it("does not call Cloudflare while disabled by default or denied", async () => {
  const f = await fixture();
  expect(await f.search.status()).toMatchObject({ enabled: false, needed: [] });
  await expect(f.search.indexPage(f.page.id)).rejects.toMatchObject({
    status: 403,
    code: "SEARCH_DISABLED",
  });
  await expect(f.search.search("knowledge")).rejects.toMatchObject({
    status: 403,
  });
  expect(f.bindings.AI.run).not.toHaveBeenCalled();
  expect(f.bindings.PAGES_VECTORIZE.query).not.toHaveBeenCalled();
});
it("indexes authorized page versions and reuses them without model calls", async () => {
  const f = await fixture();
  await enable(f.tenantId);
  expect(await f.search.status()).toMatchObject({
    needed: [f.page.id],
    indexed: 0,
  });
  await f.search.indexPage(f.page.id);
  expect(f.bindings.PAGES_VECTORIZE.upsert).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        namespace: `pages-tenant-${f.tenantId}`,
        metadata: { pageId: f.page.id, version: 1 },
      }),
    ]),
  );
  expect(await f.search.status()).toMatchObject({ needed: [], indexed: 1 });
  await f.search.indexPage(f.page.id);
  expect(f.bindings.AI.run).toHaveBeenCalledTimes(1);
  await f.pages.save(f.page.id, {
    title: "Changed",
    content: [{ type: "p", children: [{ text: "New content" }] }],
    version: 1,
  });
  expect(await f.search.status()).toMatchObject({ needed: [f.page.id] });
});
it("uses a per-page lease to prevent duplicate concurrent embeddings", async () => {
  const f = await fixture();
  await enable(f.tenantId);
  let started!: () => void;
  const embeddingStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const embeddingGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.bindings.AI.run.mockImplementationOnce(async (_model, input) => {
    started();
    await embeddingGate;
    return { data: input.text.map(() => Array(1024).fill(0.5)) };
  });

  const indexing = f.search.indexPage(f.page.id);
  await embeddingStarted;
  await expect(f.search.indexPage(f.page.id)).rejects.toMatchObject({
    status: 409,
    code: "INDEX_IN_PROGRESS",
  });
  expect(f.bindings.AI.run).toHaveBeenCalledTimes(1);
  release();
  await indexing;
  await f.search.indexPage(f.page.id);
  expect(f.bindings.AI.run).toHaveBeenCalledTimes(1);
});
it("releases its indexing lease after a failed job so a retry can run", async () => {
  const f = await fixture();
  await enable(f.tenantId);
  f.bindings.AI.run.mockRejectedValueOnce(
    new Error("temporary embedding failure"),
  );

  await expect(f.search.indexPage(f.page.id)).rejects.toThrow(
    "temporary embedding failure",
  );
  expect(
    await env.DB.prepare(
      "SELECT token FROM tenant_page_search_index_leases WHERE tenant_id=? AND page_id=?",
    )
      .bind(f.tenantId, f.page.id)
      .first(),
  ).toBeNull();

  await expect(f.search.indexPage(f.page.id)).resolves.toMatchObject({
    id: f.page.id,
    version: 1,
    reused: false,
  });
  expect(f.bindings.AI.run).toHaveBeenCalledTimes(2);
});
it("reclaims an expired indexing lease", async () => {
  const f = await fixture();
  await enable(f.tenantId);
  await env.DB.prepare(
    "INSERT INTO tenant_page_search_index_leases(tenant_id,page_id,token,expires_at) VALUES(?,?,?,?)",
  )
    .bind(f.tenantId, f.page.id, "expired-worker", Date.now() - 1)
    .run();

  await expect(f.search.indexPage(f.page.id)).resolves.toMatchObject({
    id: f.page.id,
    version: 1,
    reused: false,
  });
  expect(f.bindings.AI.run).toHaveBeenCalledTimes(1);
  expect(
    await env.DB.prepare(
      "SELECT token FROM tenant_page_search_index_leases WHERE tenant_id=? AND page_id=?",
    )
      .bind(f.tenantId, f.page.id)
      .first(),
  ).toBeNull();
});
it("scopes retrieval to tenant and drops unauthorized, deleted, stale and duplicate matches", async () => {
  const f = await fixture();
  await enable(f.tenantId);
  const other = await fixture();
  const privatePage = await new PagesService(env.DB, other.actor).create({
    title: "Other tenant secret",
  });
  f.bindings.PAGES_VECTORIZE.query.mockResolvedValue({
    matches: [
      {
        id: "other",
        score: 1,
        metadata: { pageId: privatePage.id, version: 1 },
      },
      { id: "stale", score: 0.9, metadata: { pageId: f.page.id, version: 2 } },
      { id: "valid", score: 0.8, metadata: { pageId: f.page.id, version: 1 } },
      {
        id: "duplicate",
        score: 0.7,
        metadata: { pageId: f.page.id, version: 1 },
      },
      {
        id: "deleted",
        score: 0.6,
        metadata: { pageId: "missing", version: 1 },
      },
    ],
  });
  const hits = await f.search.search("knowledge");
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({
    id: f.page.id,
    title: "Shared knowledge",
    score: 0.8,
  });
  expect(hits[0]).not.toHaveProperty("content");
  expect(f.bindings.PAGES_VECTORIZE.query).toHaveBeenCalledWith(
    expect.any(Array),
    {
      namespace: `pages-tenant-${f.tenantId}`,
      topK: 50,
      returnMetadata: "all",
    },
  );
});
it("returns semantic excerpts from the authorized matched content chunk only", async () => {
  const f = await fixture();
  await enable(f.tenantId);
  const firstParagraph = "early body ".repeat(40);
  const secondParagraph = `matched semantic needle context ${"later body ".repeat(40)}`;
  await f.pages.save(f.page.id, {
    title: "Semantic excerpt page",
    content: [
      { type: "p", children: [{ text: firstParagraph }] },
      { type: "p", children: [{ text: secondParagraph }] },
    ],
    version: 1,
  });
  const vectors: Array<{
    id: string;
    values: number[];
    namespace: string;
    metadata: { pageId: string; version: number };
  }> = [];
  f.bindings.PAGES_VECTORIZE.upsert.mockImplementation(async (items) => {
    vectors.push(...items);
    return {};
  });
  await f.search.indexPage(f.page.id);
  const matched = vectors.find((vector) => vector.id.endsWith(":1"));
  expect(matched).toBeDefined();
  f.bindings.PAGES_VECTORIZE.query.mockResolvedValue({
    matches: [
      {
        id: matched!.id,
        score: 0.9,
        metadata: {
          pageId: f.page.id,
          version: 2,
          text: "untrusted provider text",
          excerpt: "untrusted provider excerpt",
        },
      },
    ],
  });

  const [result] = await f.search.search("needle");
  expect(result).toMatchObject({ title: "Semantic excerpt page" });
  expect(result.excerpt).toContain("matched semantic needle context");
  expect(result.excerpt.length).toBeLessThanOrEqual(360);
  expect(JSON.stringify(result)).not.toContain("untrusted provider");
  expect(result).not.toHaveProperty("content");
});
it("drops a semantic match when page authorization is revoked after vector retrieval", async () => {
  const f = await fixture();
  await enable(f.tenantId);
  const other = await fixture();
  await f.search.indexPage(f.page.id);
  f.bindings.PAGES_VECTORIZE.query.mockImplementationOnce(async () => {
    await env.DB.prepare("UPDATE pages SET owner_id=? WHERE id=?")
      .bind(other.actor.principal.id, f.page.id)
      .run();
    return {
      matches: [
        {
          id: "a".repeat(48) + ":0",
          score: 0.9,
          metadata: { pageId: f.page.id, version: 1 },
        },
      ],
    };
  });

  expect(await f.search.search("knowledge")).toEqual([]);
});
it("rejects permission revocation while embedding and never submits vectors", async () => {
  const f = await fixture();
  await enable(f.tenantId);
  f.bindings.AI.run.mockImplementationOnce(async (_model, input) => {
    await env.DB.prepare(
      "UPDATE tenant_pages_search_settings SET allowed=0,enabled=0 WHERE tenant_id=?",
    )
      .bind(f.tenantId)
      .run();
    return { data: input.text.map(() => Array(1024).fill(0.5)) };
  });
  await expect(f.search.indexPage(f.page.id)).rejects.toMatchObject({
    status: 403,
  });
  expect(f.bindings.PAGES_VECTORIZE.upsert).not.toHaveBeenCalled();
});
it("fails closed on missing bindings and changed pages during embeddings", async () => {
  const f = await fixture();
  await enable(f.tenantId);
  await expect(
    new CloudflarePagesSearch(env.DB, f.actor).search("x"),
  ).rejects.toMatchObject({ status: 503 });
  f.bindings.AI.run.mockImplementationOnce(async (_model, input) => {
    await f.pages.save(f.page.id, {
      title: "New version",
      content: [{ type: "p", children: [{ text: "Updated" }] }],
      version: 1,
    });
    return { data: input.text.map(() => Array(1024).fill(0.5)) };
  });
  await expect(f.search.indexPage(f.page.id)).rejects.toMatchObject({
    status: 409,
  });
  expect(f.bindings.PAGES_VECTORIZE.upsert).not.toHaveBeenCalled();
});

it("blocks model calls when the tenant query rate limit is exhausted", async () => {
  const f = await fixture();
  await enable(f.tenantId);
  const limiter = { limit: vi.fn(async () => ({ success: false })) };
  await expect(
    new CloudflarePagesSearch(env.DB, f.actor, {
      ...f.bindings,
      PAGES_SEARCH_RATE_LIMITER: limiter,
    }).search("knowledge"),
  ).rejects.toMatchObject({ status: 429, code: "SEARCH_RATE_LIMITED" });
  expect(f.bindings.AI.run).not.toHaveBeenCalled();
  expect(limiter.limit).toHaveBeenCalledWith({
    key: `pages-tenant-${f.tenantId}`,
  });
});

it("registers semantic routes before page ids and enforces the gate over HTTP", async () => {
  const f = await fixture();
  const app = createTestApp({
    auth: { authenticate: async () => f.actor },
    pagesSearch: f.bindings,
  });
  const response = await app.request("/v1/pages/search/status");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: { enabled: false, total: 0 },
  });
  const denied = await app.request("/v1/pages/search?q=knowledge");
  expect(denied.status).toBe(403);
  expect(f.bindings.AI.run).not.toHaveBeenCalled();
  expect((await app.request("/v1/pages/search?q=")).status).toBe(400);
});
