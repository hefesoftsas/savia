import Dexie, { type Table } from "dexie";
import type { Index, IndexedDB } from "flexsearch";
import { pageSearchCacheName } from "./browser-search-cache";

export type SearchPageSummary = { id: string; title: string; version: number };
export type SearchPage = SearchPageSummary & { content: unknown };
export type SearchHit = { id: string; score: number };
type Manifest = { id: string; version: number; chunks: string[] };
class SearchMetadata extends Dexie {
  pages!: Table<Manifest, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ pages: "id" });
  }
}
let engine: Promise<typeof import("flexsearch")> | undefined;
function loadEngine() {
  // FlexSearch 0.8.212's browser adapter captures window.indexedDB at import.
  // In this dedicated Worker, its browser API lives on self. No DOM is exposed.
  if (typeof window === "undefined" && typeof self !== "undefined")
    (self as unknown as { window: typeof self }).window = self;
  return (engine ??= import("flexsearch"));
}
async function locked<T>(name: string, task: () => Promise<T>): Promise<T> {
  if (
    typeof WorkerGlobalScope !== "undefined" &&
    self instanceof WorkerGlobalScope &&
    !navigator.locks
  )
    throw new Error("Web Locks are required for the persistent search cache");
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(name, task)
    : task();
}

/** Only saved rich-text leaves are indexed; linked collections/files are not fetched. */
export function pageTextChunks(content: unknown): string[] {
  function text(node: unknown): string {
    if (Array.isArray(node)) return node.map(text).filter(Boolean).join("\n");
    if (!node || typeof node !== "object") return "";
    const value = node as {
      type?: unknown;
      text?: unknown;
      children?: unknown;
    };
    if (typeof value.text === "string") return value.text;
    if (Array.isArray(value.children)) {
      const body = value.children.map(text).join("");
      return value.type === "a" || value.type === "link" ? body : `${body}\n`;
    }
    return "";
  }
  const body = text(content).replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  for (let start = 0; start < body.length; start += 1050) {
    chunks.push(body.slice(start, start + 1200));
    if (start + 1200 >= body.length) break;
  }
  return chunks.length ? chunks : [""];
}

export async function openPageSearchIndex(
  scope: string,
  summaries: SearchPageSummary[],
  rebuild = false,
) {
  const name = await pageSearchCacheName(scope);
  const { Index, IndexedDB } = await loadEngine();
  const store = new IndexedDB(name);
  const index = new Index<false, IndexedDB>({
    tokenize: "forward",
    cache: false,
    commit: false,
  });
  const metadata = new SearchMetadata(name);
  const current = new Map(summaries.map((page) => [page.id, page]));
  try {
    await index.mount(store);
    const plan = await locked(name, async () => {
      // A surviving manifest with an evicted postings database cannot be reused.
      const existing = await metadata.pages.toArray();
      const evicted =
        existing.length > 0 && !(await index.contain(existing[0].chunks[0]));
      if (rebuild || evicted) {
        await index.clear();
        await metadata.pages.clear();
      }
      for (const record of await metadata.pages.toArray()) {
        if (!current.has(record.id)) {
          for (const id of record.chunks) index.remove(id);
          await index.commit();
          await metadata.pages.delete(record.id);
        }
      }
      const records = new Map(
        (await metadata.pages.toArray()).map((p) => [p.id, p]),
      );
      const needed = summaries
        .filter((p) => records.get(p.id)?.version !== p.version)
        .map((p) => p.id);
      return {
        needed,
        reused: summaries.length - needed.length,
        total: summaries.length,
      };
    });
    return {
      plan,
      async upsert(page: SearchPage) {
        const approved = current.get(page.id);
        if (!approved || page.version !== approved.version)
          throw new Error("Page changed during indexing");
        await locked(name, async () => {
          const previous = await metadata.pages.get(page.id);
          if (previous && previous.version > page.version)
            throw new Error("More recent page version already indexed");
          const chunks = pageTextChunks(page.content);
          const ids = chunks.map((_, i) => `${page.id}:${i}`);
          // Dirty metadata survives cancellation between databases; the next
          // open requests this page again and removes all possibly written IDs.
          const dirtyIds = [...new Set([...(previous?.chunks ?? []), ...ids])];
          await metadata.pages.put({
            id: page.id,
            version: -1,
            chunks: dirtyIds,
          });
          if (previous?.chunks.length) {
            for (const id of previous.chunks) index.remove(id);
            await index.commit();
          }
          for (let offset = 0; offset < chunks.length; offset += 32) {
            for (let i = offset; i < Math.min(offset + 32, chunks.length); i++)
              index.add(ids[i], `${page.title}. ${chunks[i]}`);
            await index.commit();
          }
          await metadata.pages.put({
            id: page.id,
            version: page.version,
            chunks: ids,
          });
        });
      },
      async count() {
        return (await metadata.pages.toArray()).filter(
          (p) => current.get(p.id)?.version === p.version,
        ).length;
      },
      async search(term: string): Promise<SearchHit[]> {
        if (!term.trim()) return [];
        const records = (await metadata.pages.toArray()).filter(
          (p) => current.get(p.id)?.version === p.version,
        );
        const owners = new Map(
          records.flatMap((p) => p.chunks.map((id) => [id, p.id] as const)),
        );
        const matches = await index.search(term, { limit: 100 });
        const seen = new Set<string>();
        const hits: SearchHit[] = [];
        for (const [rank, chunk] of matches.entries()) {
          const id = owners.get(String(chunk));
          if (!id || seen.has(id)) continue;
          seen.add(id);
          hits.push({ id, score: 1 / (rank + 1) });
          if (hits.length === 20) break;
        }
        return hits;
      },
      close() {
        store.close();
        metadata.close();
      },
    };
  } catch (error) {
    store.close();
    metadata.close();
    throw error;
  }
}
