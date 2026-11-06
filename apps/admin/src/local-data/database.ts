import Dexie, { type Table } from "dexie";
import type {
  LinkSnapshot,
  StoredRecord,
  CollectionManifest,
  Mutation,
  SyncState,
  Conflict,
} from "./contracts";
export class LocalDatabase extends Dexie {
  linkSnapshots!: Table<LinkSnapshot, [string, string]>;
  records!: Table<StoredRecord, [string, string]>;
  collections!: Table<CollectionManifest, string>;
  outbox!: Table<Mutation, string>;
  syncState!: Table<SyncState, string>;
  conflicts!: Table<Conflict, string>;
  constructor(scope: string) {
    super(`savia-local-v1:${scope}`);
    this.version(1).stores({
      records: "[collection+id],collection,*sortKeys",
      collections: "name",
      outbox: "mutationId,collection,[collection+id],sequence,state",
      syncState: "collection",
      conflicts: "mutationId,collection",
    });
    this.version(2).stores({ linkSnapshots: "[collection+id],collection" });
  }
}
