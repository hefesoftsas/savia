import type { QueryClient, Query } from "@tanstack/react-query";
const relatedKeys = new Set([
  "summary",
  "pipeline",
  "record-detail",
  "relation-labels",
  "open-record",
]);
function collectionQuery(query: Query, names: Set<string>) {
  const [first, second] = query.queryKey;
  return (
    names.has(String(first)) ||
    (relatedKeys.has(String(first)) && names.has(String(second))) ||
    (["relation-selected", "relation-options"].includes(String(first)) &&
      names.has(String(query.queryKey[3])))
  );
}
/** Reset revoked data immediately; failed refetches must not retain private rows. */
export async function reconcileLocalQueries(
  client: QueryClient,
  previous: Set<string>,
  current: Set<string>,
) {
  const removed = new Set([...previous].filter((name) => !current.has(name)));
  if (removed.size) {
    const predicate = (query: Query) =>
      collectionQuery(query, removed) || query.queryKey[0] === "/api/objects";
    await client.cancelQueries({ predicate });
    await client.resetQueries({ predicate });
  }
  await client.invalidateQueries({
    predicate: (query) => collectionQuery(query, current),
  });
}
