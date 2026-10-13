import type { SaviaCollectionEvent } from "@savia/studio-shared/savia-flows";

export interface SaviaCollectionSubscription {
  collection: string;
  operations: readonly SaviaCollectionEvent["operation"][];
  watchedFields?: string[];
  conditions?: Array<{
    field: string;
    source: "before" | "after";
    equals: unknown;
  }>;
  ignoreOwnChanges: boolean;
  batchWindowSeconds?: 0 | 60;
}

export function matchesSaviaCollectionSubscription(
  event: SaviaCollectionEvent,
  subscription: SaviaCollectionSubscription,
  tenant: string,
  workflowId: string,
): boolean {
  if (event.tenant !== tenant || event.collection !== subscription.collection)
    return false;
  if (!subscription.operations.includes(event.operation)) return false;
  if (event.cause && event.cause.depth >= 8) return false;
  if (
    subscription.ignoreOwnChanges &&
    event.cause?.workflowIds.includes(workflowId)
  )
    return false;
  if (
    subscription.watchedFields?.length &&
    !subscription.watchedFields.some((field) =>
      event.changedFields.includes(field),
    )
  )
    return false;
  return (subscription.conditions ?? []).every((condition) => {
    const record = condition.source === "before" ? event.before : event.after;
    if (!record || !(condition.field in record)) return false;
    return jsonEqual(record[condition.field], condition.equals);
  });
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === undefined || right === undefined) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}
