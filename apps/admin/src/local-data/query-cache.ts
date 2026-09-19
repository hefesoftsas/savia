import Dexie, { RangeSet, rangesOverlap, type ObservabilitySet } from "dexie";

const MAX_ENTRIES = 8;
const MAX_IDS = 100_000;
type Entry = { collection: string; ids: string[] };
const caches = new WeakMap<Dexie, ReturnType<typeof createCache>>();
function createCache(db: Dexie) {
  const entries = new Map<string, Entry>();
  let size = 0;
  let disposed = false;
  const remove = (key: string) => {
    size -= entries.get(key)?.ids.length ?? 0;
    entries.delete(key);
  };
  const prefix = `idb://${db.name}/records/`;
  const changed = (parts: ObservabilitySet) => {
    const ranges = [parts[prefix], parts[`${prefix}:dels`]];
    for (const [key, entry] of entries) {
      const scope = new RangeSet(
        [entry.collection, Dexie.minKey],
        [entry.collection, Dexie.maxKey],
      );
      if (ranges.some((range) => range && rangesOverlap(range, scope)))
        remove(key);
    }
  };
  Dexie.on("storagemutated", changed);
  const dispose = () => {
    Dexie.on("storagemutated").unsubscribe(changed);
    disposed = true;
    entries.clear();
    size = 0;
    caches.delete(db);
    db.on("close").unsubscribe(dispose);
  };
  db.on("close", dispose);
  return {
    get(key: string) {
      if (disposed) return undefined;
      const value = entries.get(key);
      if (value) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value?.ids;
    },
    put(key: string, collection: string, ids: string[]) {
      if (disposed) return;
      remove(key);
      if (ids.length > MAX_IDS) return;
      while (entries.size >= MAX_ENTRIES || size + ids.length > MAX_IDS)
        remove(entries.keys().next().value!);
      entries.set(key, { collection, ids });
      size += ids.length;
    },
  };
}
/** IDs only, bounded per open database; committed changes invalidate across connections/tabs. */
export function queryCache(db: Dexie) {
  let cache = caches.get(db);
  if (!cache) {
    cache = createCache(db);
    caches.set(db, cache);
  }
  return cache;
}
