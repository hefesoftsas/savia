import type { AppActor } from "../auth/types";
import { chunkText, CLOUDFLARE_EMBEDDING_MODEL } from "../assistant/rag";
import { activeTenant, PagesError, PagesService } from "./service";
import { readPagesSearchSettings } from "./search-settings";

export type PagesSearchBindings = {
  PAGES_SEARCH_RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
  AI?: {
    run(
      model: string,
      input: { text: string[] },
    ): Promise<{ data: number[][] }>;
  };
  PAGES_VECTORIZE?: {
    upsert(
      vectors: Array<{
        id: string;
        values: number[];
        namespace: string;
        metadata: { pageId: string; version: number };
      }>,
    ): Promise<unknown>;
    query(
      vector: number[],
      options: { namespace: string; topK: number; returnMetadata: "all" },
    ): Promise<{
      matches: Array<{
        id: string;
        score: number;
        metadata?: Record<string, unknown>;
      }>;
    }>;
    deleteByIds(ids: string[]): Promise<unknown>;
  };
};
const unavailable = () =>
  new PagesError(503, "SEARCH_UNAVAILABLE", "Cloudflare search is unavailable");
export class CloudflarePagesSearch {
  private pages: PagesService;
  constructor(
    private db: D1Database,
    private actor: AppActor,
    private bindings: PagesSearchBindings = {},
  ) {
    this.pages = new PagesService(db, actor);
  }
  async status() {
    const tenantId = await activeTenant(this.db, this.actor);
    const settings = await readPagesSearchSettings(this.db, tenantId);
    const available = Boolean(
      this.bindings.AI && this.bindings.PAGES_VECTORIZE,
    );
    if (!settings.effectiveEnabled || !available)
      return {
        enabled: settings.effectiveEnabled,
        available,
        total: 0,
        indexed: 0,
        needed: [] as string[],
      };
    const pages = (await this.pages.list("")).filter(
      (page) => page.kind === "page",
    );
    const records = await this.db
      .prepare(
        "SELECT page_id,version FROM tenant_page_search_index WHERE tenant_id=?",
      )
      .bind(tenantId)
      .all<{ page_id: string; version: number }>();
    const versions = new Map(
      records.results.map((row) => [row.page_id, row.version]),
    );
    const needed = pages
      .filter((page) => versions.get(page.id) !== page.version)
      .map((page) => page.id);
    return {
      enabled: true,
      available,
      total: pages.length,
      indexed: pages.length - needed.length,
      needed,
    };
  }
  private async authorized() {
    const tenantId = await activeTenant(this.db, this.actor);
    if (!(await readPagesSearchSettings(this.db, tenantId)).effectiveEnabled)
      throw new PagesError(
        403,
        "SEARCH_DISABLED",
        "Cloudflare search is disabled for this tenant",
      );
    if (!this.bindings.AI || !this.bindings.PAGES_VECTORIZE)
      throw unavailable();
    return {
      tenantId,
      ai: this.bindings.AI,
      index: this.bindings.PAGES_VECTORIZE,
    };
  }
  async indexPage(pageId: string) {
    const { tenantId, ai, index } = await this.authorized();
    const page = await this.pages.get(pageId);
    if (page.kind !== "page")
      throw new PagesError(400, "INVALID_PAGE", "Only pages can be indexed");
    const previous = await this.db
      .prepare(
        "SELECT version,vector_ids FROM tenant_page_search_index WHERE page_id=? AND tenant_id=?",
      )
      .bind(page.id, tenantId)
      .first<{ version: number; vector_ids: string }>();
    if (previous?.version === page.version)
      return { id: page.id, version: page.version, reused: true };
    const leaves = (nodes: unknown): string =>
      Array.isArray(nodes)
        ? nodes.map(leaves).join(" ")
        : nodes && typeof nodes === "object"
          ? typeof (nodes as { text?: unknown }).text === "string"
            ? (nodes as { text: string }).text
            : leaves((nodes as { children?: unknown }).children)
          : "";
    const chunks = chunkText(`${page.title}\n\n${leaves(page.content)}`);
    const response: { data: number[][] } = { data: [] };
    for (let offset = 0; offset < chunks.length; offset += 32) {
      await this.authorized();
      response.data.push(
        ...(
          await ai.run(CLOUDFLARE_EMBEDDING_MODEL, {
            text: chunks.slice(offset, offset + 32),
          })
        ).data,
      );
    }
    if (
      response.data.length !== chunks.length ||
      response.data.some(
        (vector) =>
          !Array.isArray(vector) ||
          vector.length !== 1024 ||
          vector.some((value) => !Number.isFinite(value)),
      )
    )
      throw unavailable();
    await this.authorized();
    const current = await this.pages.get(page.id);
    if (current.version !== page.version)
      throw new PagesError(
        409,
        "VERSION_CONFLICT",
        "Page changed during indexing",
      );
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${tenantId}:${page.id}:${page.version}`),
    );
    const prefix = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    )
      .join("")
      .slice(0, 48);
    const vectors = response.data.map((values, i) => ({
      id: `${prefix}:${i}`,
      values,
      namespace: `pages-tenant-${tenantId}`,
      metadata: { pageId: page.id, version: page.version },
    }));
    await index.upsert(vectors);
    await this.db
      .prepare(
        `INSERT INTO tenant_page_search_index(page_id,tenant_id,version,vector_ids,updated_at)
      SELECT id,tenant_id,version,?,? FROM pages WHERE id=? AND tenant_id=? AND version=?
      ON CONFLICT(page_id) DO UPDATE SET version=excluded.version,vector_ids=excluded.vector_ids,updated_at=excluded.updated_at WHERE tenant_page_search_index.version<=excluded.version`,
      )
      .bind(
        JSON.stringify(vectors.map((vector) => vector.id)),
        new Date().toISOString(),
        page.id,
        tenantId,
        page.version,
      )
      .run();
    if (previous)
      await index
        .deleteByIds(JSON.parse(previous.vector_ids) as string[])
        .catch(() => undefined);
    await this.authorized();
    return { id: page.id, version: page.version, reused: false };
  }
  async search(query: string) {
    const { tenantId, ai, index } = await this.authorized();
    if (!query.trim()) return [];
    if (
      this.bindings.PAGES_SEARCH_RATE_LIMITER &&
      !(
        await this.bindings.PAGES_SEARCH_RATE_LIMITER.limit({
          key: `pages-tenant-${tenantId}`,
        })
      ).success
    )
      throw new PagesError(
        429,
        "SEARCH_RATE_LIMITED",
        "Tenant semantic search limit reached; retry in a minute",
      );
    const embedding = await ai.run(CLOUDFLARE_EMBEDDING_MODEL, {
      text: [query.trim()],
    });
    const vector = embedding.data[0];
    if (
      !vector ||
      vector.length !== 1024 ||
      vector.some((value) => !Number.isFinite(value))
    )
      throw unavailable();
    await this.authorized();
    const results = await index.query(vector, {
      namespace: `pages-tenant-${tenantId}`,
      topK: 50,
      returnMetadata: "all",
    });
    const hits = [];
    const seen = new Set<string>();
    for (const hit of results.matches) {
      const pageId = hit.metadata?.pageId;
      if (typeof pageId !== "string" || seen.has(pageId)) continue;
      try {
        const page = await this.pages.get(pageId);
        if (page.kind !== "page" || page.version !== hit.metadata?.version)
          continue;
        seen.add(pageId);
        const { content, ...summary } = page;
        hits.push({ ...summary, score: hit.score });
        if (hits.length >= 20) break;
      } catch (error) {
        if (!(error instanceof PagesError && error.status === 404)) throw error;
      }
    }
    await this.authorized();
    return hits;
  }
}
