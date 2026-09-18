import { getOfflineDb, type CollectionVersionRow } from "./db";

export type VersionTable = {
  get(key: string): Promise<CollectionVersionRow | undefined>;
  put(row: CollectionVersionRow): Promise<unknown>;
};

function table(overrides?: VersionTable): VersionTable {
  return overrides ?? getOfflineDb().collectionVersions;
}

export async function getCollectionVersion(
  key: string,
  overrides?: VersionTable,
): Promise<number | undefined> {
  try {
    return (await table(overrides).get(key))?.version;
  } catch {
    return undefined;
  }
}

export async function setCollectionVersion(
  key: string,
  version: number,
  overrides?: VersionTable,
): Promise<void> {
  try {
    const current = await table(overrides).get(key);
    if (current !== undefined && current.version >= version) return;
    await table(overrides).put({ key, version, updatedAt: Date.now() });
  } catch {
    // Version tracking is advisory: never break the UI over it.
  }
}

/**
 * Whether a versioned realtime event is already covered locally.
 * Events without a version (identity topics, old servers) always refetch.
 */
export function isCoveredByVersion(
  knownVersion: number | undefined,
  eventVersion: number | undefined,
): boolean {
  return (
    knownVersion !== undefined &&
    eventVersion !== undefined &&
    eventVersion <= knownVersion
  );
}
