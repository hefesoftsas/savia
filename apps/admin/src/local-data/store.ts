import { liveQuery } from "dexie";
import type { CrmRecord } from "@savia/crm-shared/metadata";
import { createRecordSortKeys } from "./query";
import { LocalDatabase } from "./database";
import type {
  CollectionManifest,
  LocalStatus,
  Mutation,
  PullBatch,
} from "./contracts";
function overlay(
  document: CrmRecord | undefined,
  mutation: Mutation,
): CrmRecord {
  const now = new Date().toISOString();
  return {
    ...(document ?? { id: mutation.id, created_at: now, updated_at: now }),
    ...mutation.data,
    id: mutation.id,
    updated_at: now,
    ...(mutation.action === "delete" ? { deleted_at: now } : {}),
  };
}
export class LocalStore {
  readonly db: LocalDatabase;
  private syncError?: string;
  private listeners = new Set<() => void>();
  setSyncError(message?: string) {
    if (this.syncError === message) return;
    this.syncError = message;
    for (const listener of this.listeners) listener();
  }
  constructor(readonly scope: string) {
    this.db = new LocalDatabase(scope);
  }
  async row(collection: string, document: CrmRecord) {
    const metadata = await this.db.collections.get(collection);
    return {
      collection,
      id: document.id,
      document,
      sortKeys: createRecordSortKeys(
        collection,
        document,
        Object.keys(metadata?.object?.config?.fields ?? {}),
      ),
    };
  }
  async get(collection: string, id: string) {
    return (await this.db.records.get([collection, id]))?.document;
  }
  async mutate(
    collection: string,
    action: Mutation["action"],
    id: string,
    data?: Record<string, unknown>,
    baseVersion?: number,
  ) {
    return this.db.transaction(
      "rw",
      this.db.records,
      this.db.outbox,
      this.db.collections,
      async () => {
        const metadata = await this.db.collections.get(collection);
        if (metadata?.capability !== "read-write")
          throw new Error("Collection is not writable locally");
        const current = await this.get(collection, id);
        const last = await this.db.outbox.orderBy("sequence").last();
        const mutation: Mutation = {
          mutationId: crypto.randomUUID(),
          collection,
          id,
          action,
          data,
          baseVersion: baseVersion ?? current?._version,
          sequence: (last?.sequence ?? 0) + 1,
          before: current,
          state: "pending",
        };
        const document = overlay(current, mutation);
        await this.db.records.put(await this.row(collection, document));
        await this.db.outbox.add(mutation);
        return document;
      },
    );
  }
  async refreshManifest(collections: CollectionManifest[]) {
    await this.db.transaction(
      "rw",
      this.db.collections,
      this.db.records,
      this.db.syncState,
      this.db.outbox,
      this.db.conflicts,
      async () => {
        const priorCollections = new Map(
          (await this.db.collections.toArray()).map((c) => [c.name, c]),
        );
        const names = new Set(
          collections
            .filter((c) => c.capability !== "remote")
            .map((c) => c.name),
        );
        for (const old of await this.db.collections.toArray())
          if (!names.has(old.name)) {
            for (const mutation of await this.db.outbox
              .where("collection")
              .equals(old.name)
              .toArray()) {
              const localSnapshot = await this.get(old.name, mutation.id);
              if (localSnapshot)
                await this.db.outbox.update(mutation.mutationId, {
                  localSnapshot,
                });
            }
            await this.db.records.where("collection").equals(old.name).delete();
            await this.db.outbox.where("collection").equals(old.name).modify({
              state: "error",
              error:
                "Collection access revoked or moved to remote; local edits retained",
            });
            await this.db.syncState.delete(old.name);
          }
        await this.db.collections.clear();
        await this.db.collections.bulkPut(collections);
        for (const collection of collections) {
          const prior = priorCollections.get(collection.name);
          const fields = Object.keys(collection.object?.config?.fields ?? {});
          if (
            prior &&
            collection.capability !== "remote" &&
            (prior.schemaVersion !== collection.schemaVersion ||
              JSON.stringify(
                Object.keys(prior.object?.config?.fields ?? {}).sort(),
              ) !== JSON.stringify([...fields].sort()))
          ) {
            await this.db.records
              .where("collection")
              .equals(collection.name)
              .modify((row) => {
                row.sortKeys = createRecordSortKeys(
                  collection.name,
                  row.document,
                  fields,
                );
              });
          }
        }
        for (const mutation of await this.db.outbox.toArray()) {
          if (mutation.localSnapshot && names.has(mutation.collection)) {
            await this.db.records.put(
              await this.row(mutation.collection, mutation.localSnapshot),
            );
            await this.db.outbox.update(mutation.mutationId, {
              localSnapshot: undefined,
            });
          }
        }
      },
    );
  }
  async applyPull(collection: string, batch: PullBatch) {
    await this.db.transaction(
      "rw",
      this.db.records,
      this.db.outbox,
      this.db.syncState,
      this.db.collections,
      async () => {
        const pending = await this.db.outbox
          .where("collection")
          .equals(collection)
          .toArray();
        const protectedIds = new Set(pending.map((m) => m.id));
        if (batch.reset)
          await this.db.records
            .where("collection")
            .equals(collection)
            .filter((r) => !protectedIds.has(r.id))
            .delete();
        for (const document of batch.documents)
          if (!protectedIds.has(document.id))
            await this.db.records.put(await this.row(collection, document));
        const prior = await this.db.syncState.get(collection);
        await this.db.syncState.put({
          collection,
          cursor: batch.cursor,
          hydrated: (!batch.reset && prior?.hydrated) || !batch.hasMore,
          lastSyncedAt: Date.now(),
        });
      },
    );
  }
  async acknowledge(mutation: Mutation, master: CrmRecord) {
    await this.db.transaction(
      "rw",
      this.db.records,
      this.db.outbox,
      this.db.collections,
      async () => {
        if (!(await this.db.outbox.get(mutation.mutationId))) return;
        await this.db.outbox.delete(mutation.mutationId);
        const later = (
          await this.db.outbox
            .where("[collection+id]")
            .equals([mutation.collection, mutation.id])
            .toArray()
        ).sort((a, b) => a.sequence - b.sequence);
        let document = master;
        for (const next of later) {
          await this.db.outbox.update(next.mutationId, { before: document });
          document = overlay(document, next);
        }
        if (later[0])
          await this.db.outbox.update(later[0].mutationId, {
            baseVersion: master._version,
          });
        await this.db.records.put(
          await this.row(mutation.collection, document),
        );
      },
    );
  }
  async rejectMutation(
    mutation: Mutation,
    state: "conflict" | "error",
    error: string,
    master?: CrmRecord | null,
  ) {
    await this.db.transaction(
      "rw",
      this.db.outbox,
      this.db.conflicts,
      async () => {
        await this.db.outbox.update(mutation.mutationId, { state, error });
        if (state === "conflict")
          await this.db.conflicts.put({
            mutationId: mutation.mutationId,
            collection: mutation.collection,
            id: mutation.id,
            master,
            error,
          });
      },
    );
  }
  async acceptMaster(mutationId: string) {
    await this.db.transaction(
      "rw",
      this.db.records,
      this.db.outbox,
      this.db.conflicts,
      this.db.collections,
      async () => {
        const mutation = await this.db.outbox.get(mutationId);
        const conflict = await this.db.conflicts.get(mutationId);
        if (!mutation || !conflict || conflict.master === undefined)
          throw new Error("Conflict has no master record");
        const metadata = await this.db.collections.get(mutation.collection);
        if (!metadata || metadata.capability === "remote")
          throw new Error("Collection access is unavailable");
        if (conflict.master === null) {
          await this.db.outbox.delete(mutationId);
          const later = await this.db.outbox
            .where("[collection+id]")
            .equals([mutation.collection, mutation.id])
            .sortBy("sequence");
          if (later[0])
            await this.rejectMutation(
              later[0],
              "conflict",
              "Server record no longer exists",
              null,
            );
          else await this.db.records.delete([mutation.collection, mutation.id]);
        } else await this.acknowledge(mutation, conflict.master);
        await this.db.conflicts.delete(mutationId);
      },
    );
  }
  async retryWithLocal(mutationId: string) {
    await this.db.transaction(
      "rw",
      this.db.records,
      this.db.outbox,
      this.db.conflicts,
      this.db.collections,
      async () => {
        const mutation = await this.db.outbox.get(mutationId);
        if (!mutation) return;
        const metadata = await this.db.collections.get(mutation.collection);
        if (metadata?.capability !== "read-write")
          throw new Error("Collection is not writable locally");
        const conflict = await this.db.conflicts.get(mutationId);
        if (conflict?.master?.deleted_at)
          throw new Error(
            "The server record was deleted. Accept the server version or restore the record online before retrying local edits.",
          );
        if (conflict?.master === null && mutation.action === "delete") {
          await this.acceptMaster(mutationId);
          return;
        }
        let data = mutation.data;
        if (conflict?.master === null) {
          const local = await this.get(mutation.collection, mutation.id);
          data = { ...local, ...mutation.data };
          for (const key of [
            "id",
            "_version",
            "created_at",
            "updated_at",
            "deleted_at",
          ])
            delete data[key];
        }
        await this.db.outbox.delete(mutationId);
        await this.db.outbox.add({
          ...mutation,
          mutationId: crypto.randomUUID(),
          data,
          action:
            conflict?.master === null
              ? "create"
              : mutation.action === "create" && conflict?.master
                ? "update"
                : mutation.action,
          baseVersion:
            conflict?.master === null
              ? undefined
              : (conflict?.master?._version ?? mutation.baseVersion),
          state: "pending",
          error: undefined,
        });
        await this.db.conflicts.delete(mutationId);
      },
    );
  }
  async authorizationError() {
    return (await this.db.syncState.get("$authorization"))?.authorizationError;
  }
  async blockAuthorization(message: string) {
    await this.db.transaction(
      "rw",
      this.db.records,
      this.db.collections,
      this.db.syncState,
      this.db.outbox,
      async () => {
        for (const mutation of await this.db.outbox.toArray()) {
          const localSnapshot = await this.get(
            mutation.collection,
            mutation.id,
          );
          await this.db.outbox.update(mutation.mutationId, {
            state: mutation.state === "conflict" ? "conflict" : "error",
            error: message,
            localSnapshot: localSnapshot ?? mutation.localSnapshot,
          });
        }
        await this.db.records.clear();
        await this.db.collections.clear();
        await this.db.syncState.clear();
        await this.db.syncState.put({
          collection: "$authorization",
          hydrated: false,
          authorizationError: message,
        });
      },
    );
  }
  /** Call only after the session has authenticated this same principal and tenant again. */
  async resumeAuthorization() {
    await this.db.syncState.delete("$authorization");
  }
  async discardMutation(mutationId: string) {
    await this.db.transaction(
      "rw",
      this.db.records,
      this.db.collections,
      this.db.outbox,
      this.db.conflicts,
      async () => {
        const mutation = await this.db.outbox.get(mutationId);
        if (!mutation) return;
        if (mutation.state === "pending")
          throw new Error("Only rejected mutations can be discarded");
        await this.db.outbox.delete(mutationId);
        await this.db.conflicts.delete(mutationId);
        const later = await this.db.outbox
          .where("[collection+id]")
          .equals([mutation.collection, mutation.id])
          .sortBy("sequence");
        let document = mutation.before;
        for (const next of later) {
          await this.db.outbox.update(next.mutationId, { before: document });
          document = overlay(document, next);
        }
        if (mutation.action === "create" && later[0]) {
          await this.db.outbox.update(later[0].mutationId, {
            state: "error",
            error:
              "Required create was discarded; retry to recreate this record",
            baseVersion: undefined,
          });
        }
        const metadata = await this.db.collections.get(mutation.collection);
        if (document && metadata && metadata.capability !== "remote")
          await this.db.records.put(
            await this.row(mutation.collection, document),
          );
        else await this.db.records.delete([mutation.collection, mutation.id]);
      },
    );
  }
  async retryMutation(mutationId: string, data?: Record<string, unknown>) {
    await this.db.transaction(
      "rw",
      this.db.records,
      this.db.collections,
      this.db.outbox,
      this.db.conflicts,
      async () => {
        const mutation = await this.db.outbox.get(mutationId);
        if (!mutation) return;
        if (mutation.state !== "error")
          throw new Error("Only rejected errors can be retried");
        const metadata = await this.db.collections.get(mutation.collection);
        if (metadata?.capability !== "read-write")
          throw new Error("Collection is not writable locally");
        const retry = {
          ...mutation,
          mutationId: crypto.randomUUID(),
          data: data ? { ...mutation.data, ...data } : mutation.data,
          state: "pending" as const,
          error: undefined,
        };
        if (mutation.error?.startsWith("Required create was discarded"))
          retry.action = "create";
        await this.db.outbox.delete(mutationId);
        await this.db.outbox.add(retry);
        let document = overlay(mutation.before, retry);
        const later = (
          await this.db.outbox
            .where("[collection+id]")
            .equals([mutation.collection, mutation.id])
            .sortBy("sequence")
        ).filter((m) => m.sequence > retry.sequence);
        for (const next of later) {
          await this.db.outbox.update(next.mutationId, { before: document });
          document = overlay(document, next);
        }
        await this.db.records.put(
          await this.row(mutation.collection, document),
        );
      },
    );
  }
  async status(): Promise<LocalStatus> {
    const all = await this.db.outbox.toArray();
    const authorizationError = await this.authorizationError();
    return {
      ...(authorizationError ? { authorizationError } : {}),
      ...(this.syncError ? { syncError: this.syncError } : {}),
      pending: all.filter((m) => m.state === "pending").length,
      conflicts: all.filter((m) => m.state === "conflict").length,
      errors: all.filter((m) => m.state === "error").length,
    };
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    const subscription = liveQuery(async () => {
      await this.db.records.count();
      await this.db.collections.toArray();
      await this.db.outbox.toArray();
      await this.db.syncState.toArray();
    }).subscribe({ next: listener });
    return () => {
      this.listeners.delete(listener);
      subscription.unsubscribe();
    };
  }
  close() {
    this.listeners.clear();
    this.db.close();
  }
  async destroy() {
    await this.db.delete();
  }
}
export async function openLocalStore(scope: string) {
  const store = new LocalStore(scope);
  await store.db.open();
  return store;
}
