import { ApiClientError, type ApiClient } from "@/api/api-client";
import type { PageDocument, PageSummary } from "./client";

const FRESH_MS = 60_000;
const READ_TIMEOUT_MS = 15_000;
const MAX_ENTRIES = 64;
type Entry = { value: unknown; savedAt: number };
let caches = new WeakMap<ApiClient, PagesReadCache>();
let session = 0;
if (typeof window !== "undefined") {
  const clear = () => {
    session++;
    caches = new WeakMap();
  };
  window.addEventListener("savia:session-cleared", clear);
  window.addEventListener("savia:principal-changed", clear);
}

/** Bounded, session-only read cache. Never persist private page content globally. */
class PagesReadCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<unknown>>();
  private revision = 0;
  private readonly session = session;

  peek<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || this.session !== session) return;
    if (navigator.onLine !== false && Date.now() - entry.savedAt >= FRESH_MS)
      return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    // Editors may mutate Slate nodes; never hand them the retained snapshot.
    return structuredClone(entry.value) as T;
  }

  private put(key: string, value: unknown, savedAt = Date.now()) {
    if (this.session !== session) return;
    this.entries.delete(key);
    this.entries.set(key, {
      value: structuredClone(value),
      savedAt,
    });
    while (this.entries.size > MAX_ENTRIES)
      this.entries.delete(this.entries.keys().next().value!);
  }

  async read<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    force = false,
  ): Promise<T> {
    const cached = !force ? this.peek<T>(key) : undefined;
    if (cached !== undefined) return cached;
    const existing = this.pending.get(key);
    if (existing) return structuredClone(await existing) as T;
    if (navigator.onLine === false)
      throw new Error("Page is not available offline");
    const revision = this.revision;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Page read timed out"));
      }, READ_TIMEOUT_MS);
    });
    const request = Promise.race([load(controller.signal), timeout])
      .then(async (value) => {
        if (this.session !== session) throw new Error("Page session changed");
        // A save/delete must win over a read started before that mutation.
        if (revision !== this.revision) return this.read<T>(key, load);
        this.put(key, value);
        return value;
      })
      .catch((error: unknown) => {
        if (
          error instanceof ApiClientError &&
          [401, 403, 404].includes(error.status)
        ) {
          this.entries.clear();
          this.revision++;
          this.pending.clear();
        }
        throw error;
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.pending.get(key) === request) this.pending.delete(key);
      });
    this.pending.set(key, request);
    return structuredClone(await request) as T;
  }

  changed(page?: PageDocument, removedId?: string) {
    if (this.session !== session) throw new Error("Page session changed");
    this.revision++;
    this.pending.clear();
    const index = this.entries.get("list:");
    // Search membership/excerpts are server-derived; invalidate those queries.
    for (const key of this.entries.keys())
      if (key.startsWith("list:") && key !== "list:") this.entries.delete(key);
    if (page) this.put(`document:${page.id}`, page);
    if (removedId) this.entries.delete(`document:${removedId}`);
    if (index) {
      const pages = index.value as PageSummary[];
      const next = pages.filter((item) => item.id !== (page?.id ?? removedId));
      if (page) {
        const { content: _content, ...summary } = page;
        next.push(summary);
      }
      // The server index is bounded and ordered by recent updates.
      next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      this.put("list:", next.slice(0, 200), index.savedAt);
    }
  }

  invalidate() {
    if (this.session !== session) throw new Error("Page session changed");
    this.revision++;
    this.entries.clear();
    this.pending.clear();
  }
}
export function pagesReadCache(api: ApiClient) {
  let cache = caches.get(api);
  if (!cache) {
    cache = new PagesReadCache();
    caches.set(api, cache);
  }
  return cache;
}
