const RETIRED_PREFIXES = [
  "savia-pages-search-v1-",
  "flexsearch:savia-pages-search-v1-",
];

/** Best-effort cleanup for browser indexes retired in favor of server search. */
export async function retireLocalPageSearchCaches() {
  if (typeof indexedDB === "undefined" || !indexedDB.databases) return;
  try {
    const databases = await indexedDB.databases();
    await Promise.all(
      databases.flatMap(({ name }) => {
        if (
          !name ||
          !RETIRED_PREFIXES.some((prefix) => name.startsWith(prefix))
        )
          return [];
        return [
          new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              resolve();
            };
            const timeout = setTimeout(finish, 1000);
            try {
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = finish;
              request.onerror = finish;
              request.onblocked = finish;
            } catch {
              finish();
            }
          }),
        ];
      }),
    );
  } catch {
    // Retired cache cleanup must never delay or block the Pages screen.
  }
}
