import Dexie, { type Table } from "dexie";
import type {
  StoredRecord,
  CollectionManifest,
  Mutation,
  SyncState,
  Conflict,
} from "./contracts";
export class LocalDatabase extends Dexie {
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
  }
}
