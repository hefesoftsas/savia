import type { SaviaCollectionEvent } from "./savia-flows";

export function parseFlowCause(value: unknown): SaviaCollectionEvent["cause"] {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const cause = value as Record<string, unknown>;
  if (
    typeof cause.rootEventId !== "string" ||
    !cause.rootEventId ||
    cause.rootEventId.length > 200 ||
    !Array.isArray(cause.workflowIds) ||
    cause.workflowIds.length > 8 ||
    !cause.workflowIds.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 200,
    ) ||
    !Number.isInteger(cause.depth) ||
    Number(cause.depth) < 0 ||
    Number(cause.depth) > 8
  )
    return undefined;
  return {
    rootEventId: cause.rootEventId,
    workflowIds: cause.workflowIds as string[],
    depth: Number(cause.depth),
  };
}

/** Both execution modes carry the same ancestry through Core record writes. */
export function nativeFlowWriteCause(run: {
  workflowId: string;
  executionId: string;
  depth: number;
  cause?: unknown;
}): NonNullable<SaviaCollectionEvent["cause"]> {
  const inherited = parseFlowCause(run.cause);
  const depth = Math.max(run.depth, inherited?.depth ?? 0);
  const workflowIds = [
    ...new Set([...(inherited?.workflowIds ?? []), `native:${run.workflowId}`]),
  ];
  if (depth >= 8 || workflowIds.length > 8)
    throw new Error("The collection workflow chain limit was reached.");
  return {
    rootEventId: inherited?.rootEventId ?? run.executionId,
    workflowIds,
    depth: depth + 1,
  };
}
