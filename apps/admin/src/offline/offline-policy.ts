import { OFFLINE_PII_COLLECTIONS } from "./persisted-keys";

export type CollectionOfflinePolicy = {
  collection: string;
  enabled: boolean;
  refreshSeconds: number;
};

type PolicySnapshot = {
  enabled: Set<string>;
  refreshSeconds: Map<string, number>;
};

const snapshots = new Map<number, PolicySnapshot>();

export function setOfflinePolicySnapshot(
  tenantId: number,
  policies: CollectionOfflinePolicy[],
): void {
  snapshots.set(tenantId, {
    enabled: new Set(
      policies.filter((policy) => policy.enabled).map((policy) => policy.collection),
    ),
    refreshSeconds: new Map(
      policies.map((policy) => [policy.collection, policy.refreshSeconds]),
    ),
  });
}

export function getOfflinePolicySnapshot(
  tenantId: number,
): PolicySnapshot | undefined {
  return snapshots.get(tenantId);
}

/** For tests only. */
export function clearOfflinePolicySnapshots(): void {
  snapshots.clear();
}

/**
 * Whether a customer collection persists offline right now. Union across
 * loaded tenants (query keys are not tenant-scoped, same as the queries
 * themselves). With no snapshot loaded yet (first boot offline) falls back
 * to the static pilot set.
 */
export function isCollectionOfflineEnabled(collection: string): boolean {
  if (snapshots.size === 0) return OFFLINE_PII_COLLECTIONS.has(collection);
  for (const snapshot of snapshots.values()) {
    if (snapshot.enabled.has(collection)) return true;
  }
  return false;
}

export function collectionRefreshSeconds(
  tenantId: number,
  collection: string,
): number | undefined {
  return snapshots.get(tenantId)?.refreshSeconds.get(collection);
}
