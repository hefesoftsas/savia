import type { QuoteBatchItem } from "./screens/quote-results";

/** Replace selected flows while retaining the other successful saved offers. */
export function resumedQuoteItems(
  saved: readonly QuoteBatchItem[],
  selected: readonly QuoteBatchItem[],
): QuoteBatchItem[] {
  const selectedFlows = new Set(selected.map((item) => item.flowId));
  return [
    ...saved.filter(
      (item) => item.status === "succeeded" && !selectedFlows.has(item.flowId),
    ),
    ...selected,
  ];
}

export function quoteSummaryPatch(items: readonly QuoteBatchItem[]) {
  const succeeded = items.filter((item) => item.status === "succeeded");
  const premiums = succeeded.flatMap((item) =>
    typeof item.premium === "number" &&
    Number.isFinite(item.premium) &&
    item.premium > 0
      ? [item.premium]
      : [],
  );
  return {
    estado: succeeded.length
      ? "Recibida"
      : items.some((item) => item.status === "pending")
        ? "Solicitada"
        : "Rechazada",
    prima: premiums.length ? Math.min(...premiums) : null,
  };
}

type SummaryCollection<T> = {
  get(id: string): Promise<unknown>;
  update(
    id: string,
    patch: Record<string, unknown>,
    options: { version: number },
  ): Promise<T>;
};

const summaryWrites = new WeakMap<object, Map<string, Promise<unknown>>>();

/** Serialize this wizard's master writes, preserving optimistic concurrency against other editors. */
export function persistQuoteSummary<T>(
  collection: SummaryCollection<T>,
  id: string,
  patch: () => Record<string, unknown>,
): Promise<T> {
  let records = summaryWrites.get(collection);
  if (!records) {
    records = new Map();
    summaryWrites.set(collection, records);
  }
  const previous = records.get(id) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await collection.get(id);
      const version =
        current && typeof current === "object"
          ? (current as Record<string, unknown>)._version
          : undefined;
      if (
        typeof version !== "number" ||
        !Number.isInteger(version) ||
        version <= 0
      ) {
        throw new Error(
          "The current quote version is unavailable. The summary could not be saved.",
        );
      }
      return collection.update(id, patch(), { version });
    });
  records.set(id, next);
  const cleanup = () => {
    if (records.get(id) === next) records.delete(id);
  };
  void next.then(cleanup, cleanup);
  return next;
}
