import type { CrmObject, CrmRecord } from "@savia/crm-shared/metadata";
export type StoredRecord = {
  collection: string;
  id: string;
  document: CrmRecord;
  sortKeys?: Array<[string, string, number, string | number, string]>;
};
export type CollectionManifest = {
  name: string;
  object: CrmObject;
  capability: "read-write" | "read-only" | "remote";
  schemaVersion: number;
};
export type Mutation = {
  mutationId: string;
  collection: string;
  id: string;
  action: "create" | "update" | "delete";
  data?: Record<string, unknown>;
  baseVersion?: number;
  sequence: number;
  state: "pending" | "conflict" | "error";
  error?: string;
  before?: CrmRecord;
  localSnapshot?: CrmRecord;
};
export type SyncState = {
  collection: string;
  cursor?: string;
  hydrated: boolean;
  lastSyncedAt?: number;
  authorizationError?: string;
};
export type Conflict = {
  mutationId: string;
  collection: string;
  id: string;
  master?: CrmRecord | null;
  error: string;
};
export type PullBatch = {
  documents: CrmRecord[];
  cursor: string;
  hasMore: boolean;
  reset?: boolean;
};
export type LocalStatus = {
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
