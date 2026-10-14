import {
  hashKey,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

type PendingRead = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
  unsubscribe?: () => void;
};
const pending = new WeakMap<QueryClient, Map<string, PendingRead>>();

/** Share hint bursts by client/key, and never join an obsolete opening read. */
export function scheduleReadInvalidation(
  client: QueryClient,
  queryKeys: readonly QueryKey[],
  { immediate = false }: { immediate?: boolean } = {},
): Promise<void> {
  let reads = pending.get(client);
  if (!reads) {
    reads = new Map();
    pending.set(client, reads);
  }
  return Promise.all(
    queryKeys.map((queryKey) => {
      const hash = hashKey(queryKey);
      let read = reads.get(hash);
      if (!read) {
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<void>((done, failed) => {
          resolve = done;
          reject = failed;
        });
        read = { promise, resolve, reject };
        reads.set(hash, read);
      }
      const entry = read;
      const flush = () => {
        clearTimeout(entry.timer);
        const query = client.getQueryCache().find({ queryKey, exact: true });
        if (query?.isActive() && query.state.fetchStatus === "fetching") {
          if (!entry.unsubscribe)
            entry.unsubscribe = client.getQueryCache().subscribe(() => {
              const current = client
                .getQueryCache()
                .find({ queryKey, exact: true });
              if (current !== query || query.state.fetchStatus !== "fetching") {
                entry.unsubscribe?.();
                entry.unsubscribe = undefined;
                flush();
              }
            });
          return;
        }
        entry.unsubscribe?.();
        reads.delete(hash);
        void client
          .invalidateQueries(
            { queryKey, exact: true, refetchType: "active" },
            { cancelRefetch: false, throwOnError: true },
          )
          .then(entry.resolve, entry.reject);
      };
      clearTimeout(entry.timer);
      if (immediate) flush();
      else entry.timer = setTimeout(flush, 200);
      return entry.promise;
    }),
  ).then(() => undefined);
}
