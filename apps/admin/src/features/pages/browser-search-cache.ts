import Dexie from "dexie";

export const PAGE_SEARCH_CACHE_PREFIX = "savia-pages-search-v1-";
export const PAGE_SEARCH_CACHE_CLEAR_EVENT = "savia-pages-search-clear";
export function subscribeSearchCacheClear(callback: () => void) {
  window.addEventListener(PAGE_SEARCH_CACHE_CLEAR_EVENT, callback);
  const channel =
    typeof BroadcastChannel === "undefined"
      ? undefined
      : new BroadcastChannel(PAGE_SEARCH_CACHE_CLEAR_EVENT);
  if (channel) channel.onmessage = callback;
  return () => {
    window.removeEventListener(PAGE_SEARCH_CACHE_CLEAR_EVENT, callback);
    channel?.close();
  };
}
export async function pageSearchCacheName(scope: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(scope),
  );
  return (
    PAGE_SEARCH_CACHE_PREFIX +
    Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  );
}
/** Derived postings/versions only: never a source of page documents or permissions. */
export async function clearPageSearchCaches() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(PAGE_SEARCH_CACHE_CLEAR_EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(PAGE_SEARCH_CACHE_CLEAR_EVENT);
    channel.postMessage("clear");
    channel.close();
  }
  if (typeof indexedDB === "undefined") return;
  const names = await Dexie.getDatabaseNames();
  await Promise.all(
    names
      .filter(
        (name) =>
          name.startsWith(PAGE_SEARCH_CACHE_PREFIX) ||
          name.startsWith(`flexsearch:${PAGE_SEARCH_CACHE_PREFIX}`),
      )
      .map((name) => Dexie.delete(name)),
  );
}
