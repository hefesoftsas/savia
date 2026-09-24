import type { RelatedRecordBundle } from "@savia/studio-shared/related-records";
import type { RelationDefinition } from "@savia/studio-shared/relations";
import type { StudioObject, StudioRecord } from "@savia/studio-shared/metadata";
export type StoredRecord = {
  collection: string;
  id: string;
  document: StudioRecord;
  sortKeys?: Array<[string, string, number, string | number, string]>;
};
export type CollectionManifest = {
  name: string;
  object: StudioObject;
  capability: "read-write" | "read-only" | "remote";
  schemaVersion: number;
  latestSequence?: number;
};
export type Mutation = {
  mutationId: string;
  collection: string;
  id: string;
  action: "create" | "update" | "delete" | "bundle";
  bundle?: {
    input: RelatedRecordBundle;
    definitions: RelationDefinition[];
    members: BundleMember[];
    groups: LinkSnapshot["groups"];
  };
  data?: Record<string, unknown>;
  baseVersion?: number;
  sequence: number;
  state: "pending" | "conflict" | "error";
  error?: string;
  before?: StudioRecord;
  localSnapshot?: StudioRecord;
  quarantined?: boolean;
};
export type SyncState = {
  collection: string;
  /** Atomic record/index revision for snapshot-safe in-memory query caches. */
  dataRevision?: string;
  policyIdentity?: string;
  cursor?: string;
  hydrated: boolean;
  lastSyncedAt?: number;
  authorizationError?: string;
};
export type Conflict = {
  mutationId: string;
  collection: string;
  id: string;
  master?: StudioRecord | null;
  error: string;
};
export type PullBatch = {
  documents: StudioRecord[];
  removedIds?: string[];
  cursor: string;
  hasMore: boolean;
  reset?: boolean;
};
export type LocalStatus = {
  syncing?: boolean;
  /** Last completed workspace-wide check, not a guarantee that conflicts are resolved. */
  lastSyncedAt?: number;
  syncError?: string;
  pending: number;
  conflicts: number;
  errors: number;
  authorizationError?: string;
};
export type SyncTransport = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export type BundleMember = {
  collection: string;
  id: string;
  before?: StudioRecord;
  document: StudioRecord;
};
export type LinkSnapshot = {
  collection: string;
  id: string;
  groups: Array<{ definition: RelationDefinition; ids: string[] }>;
};
