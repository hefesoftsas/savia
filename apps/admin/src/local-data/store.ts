import {
  enqueueBundle,
  acknowledgeBundle,
  resolveBundle,
  pendingBundle,
} from "./bundle-store";
import type { RelatedRecordBundle } from "@savia/crm-shared/related-records";
import type {
  RelationDefinition,
  RecordRelationGroup,
} from "@savia/crm-shared/relations";
import Dexie, {
  liveQuery,
  rangesOverlap,
  RangeSet,
  type ObservabilitySet,
} from "dexie";
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
  /** Must be called within the same read-write transaction as the record change. */
  async touch(collection: string) {
    const prior = await this.db.syncState.get(collection);
    await this.db.syncState.put({
      collection,
      hydrated: false,
      ...prior,
      dataRevision: crypto.randomUUID(),
    });
  }
  async get(collection: string, id: string) {
    return (await this.db.records.get([collection, id]))?.document;
  }
  enqueueBundle(
    collection: string,
    input: RelatedRecordBundle,
    definitions: RelationDefinition[],
    mutationId: string,
  ) {
    return enqueueBundle(this, collection, input, definitions, mutationId);
  }
  acknowledgeBundle(
    mutation: Mutation,
    result: {
      data: CrmRecord;
      related: Array<{ relationId: string; records: CrmRecord[] }>;
    },
  ) {
    return acknowledgeBundle(this, mutation, result);
  }
  getPendingBundle(collection: string, id: string) {
    return pendingBundle(this, collection, id);
  }
  resolveBundle(
    mutationId: string,
    mode: "server" | "local",
    masters: Array<{
      collection: string;
      id: string;
      document: CrmRecord | null;
    }>,
    groups: RecordRelationGroup[],
  ) {
    return resolveBundle(this, mutationId, mode, masters, groups);
  }
  async mutate(
    collection: string,
    action: Exclude<Mutation["action"], "bundle">,
    id: string,
    data?: Record<string, unknown>,
    baseVersion?: number,
  ) {
    return this.db.transaction(
      "rw",
      [this.db.records, this.db.syncState, this.db.outbox, this.db.collections],
      async () => {
        const metadata = await this.db.collections.get(collection);
        if (metadata?.capability !== "read-write")
          throw new Error("Collection is not writable locally");
        if (await this.getPendingBundle(collection, id))
          throw new Error(
            "This record belongs to a pending bundle; synchronize or resolve it first",
          );
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
        await this.touch(collection);
        return document;
      },
    );
  }
  async refreshManifest(collections: CollectionManifest[]) {
    await this.db.transaction(
      "rw",
      [
        this.db.collections,
        this.db.records,
        this.db.syncState,
        this.db.outbox,
        this.db.conflicts,
        this.db.linkSnapshots,
      ],
      async () => {
        const changed = new Set<string>();
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
            await this.db.linkSnapshots
              .where("collection")
              .equals(old.name)
              .delete();
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
            const reindexed = await this.db.records
              .where("collection")
              .equals(collection.name)
              .modify((row) => {
                row.sortKeys = createRecordSortKeys(
                  collection.name,
                  row.document,
                  fields,
                );
              });
            if (reindexed) changed.add(collection.name);
          }
        }
        for (const mutation of await this.db.outbox.toArray()) {
          if (mutation.bundle && !mutation.quarantined) {
            for (const member of mutation.bundle.members) {
              if (names.has(member.collection)) {
                await this.db.records.put(
                  await this.row(member.collection, member.document),
                );
                changed.add(member.collection);
              }
            }
            if (names.has(mutation.collection))
              await this.db.linkSnapshots.put({
                collection: mutation.collection,
                id: mutation.id,
                groups: mutation.bundle.groups,
              });
            if (
              mutation.bundle.members.some(
                (member) =>
                  collections.find((c) => c.name === member.collection)
                    ?.capability !== "read-write",
              )
            )
              await this.db.outbox.update(mutation.mutationId, {
                state: "error",
                error: "Bundle collection access revoked; local edits retained",
              });
          }
          if (
            !mutation.quarantined &&
            mutation.localSnapshot &&
            names.has(mutation.collection)
          ) {
            await this.db.records.put(
              await this.row(mutation.collection, mutation.localSnapshot),
            );
            changed.add(mutation.collection);
            await this.db.outbox.update(mutation.mutationId, {
              localSnapshot: undefined,
            });
          }
        }
        for (const collection of changed) await this.touch(collection);
      },
    );
  }
  async applyPull(collection: string, batch: PullBatch) {
    await this.db.transaction(
      "rw",
      [
        this.db.records,
        this.db.outbox,
        this.db.syncState,
        this.db.collections,
        this.db.conflicts,
        this.db.linkSnapshots,
      ],
      async () => {
        const pending = await this.db.outbox
          .where("collection")
          .equals(collection)
          .toArray();
        const protectedIds = new Set(
          pending.filter((m) => !m.quarantined).map((m) => m.id),
        );
        for (const mutation of await this.db.outbox.toArray())
          if (!mutation.quarantined)
            for (const member of mutation.bundle?.members ?? [])
              if (member.collection === collection) protectedIds.add(member.id);
        const allPending = await this.db.outbox.toArray();
        const quarantineMember = async (id: string, error: string) => {
          for (const mutation of allPending) {
            if (mutation.collection !== collection || mutation.id !== id) {
              if (
                !mutation.bundle?.members.some(
                  (m) => m.collection === collection && m.id === id,
                )
              )
                continue;
            }
            await this.db.outbox.update(mutation.mutationId, {
              quarantined: true,
              state: "error",
              error,
            });
            await this.db.conflicts.delete(mutation.mutationId);
            for (const member of mutation.bundle?.members ?? []) {
              if (member.collection === collection)
                protectedIds.delete(member.id);
              if (member.before)
                await this.db.records.put(
                  await this.row(member.collection, member.before),
                );
              else await this.db.records.delete([member.collection, member.id]);
              await this.touch(member.collection);
            }
          }
          await this.db.linkSnapshots.clear();
        };
        let changed = false;
        for (const id of batch.removedIds ?? []) {
          await quarantineMember(id, "Record access revoked");
          await this.db.records.delete([collection, id]);
          await this.db.outbox
            .where("[collection+id]")
            .equals([collection, id])
            .modify({
              quarantined: true,
              state: "error",
              error: "Record access revoked",
            });
          for (const mutation of pending.filter((m) => m.id === id))
            await this.db.conflicts.delete(mutation.mutationId);
          changed = true;
        }
        if (batch.reset)
          changed =
            (await this.db.records
              .where("collection")
              .equals(collection)
              .filter((r) => !protectedIds.has(r.id))
              .delete()) > 0;
        for (const document of batch.documents) {
          const previous = await this.db.records.get([collection, document.id]);
          const removed =
            previous &&
            Object.keys(previous.document).some(
              (field) =>
                !["deleted_at", "created_by"].includes(field) &&
                !Object.hasOwn(document, field),
            );
          if (removed && protectedIds.has(document.id)) {
            await quarantineMember(document.id, "Record fields revoked");
            await this.db.outbox
              .where("[collection+id]")
              .equals([collection, document.id])
              .modify({
                quarantined: true,
                state: "error",
                error: "Record fields revoked",
              });
            for (const mutation of pending.filter((m) => m.id === document.id))
              await this.db.conflicts.delete(mutation.mutationId);
            protectedIds.delete(document.id);
          }
          if (
            !protectedIds.has(document.id) &&
            !batch.removedIds?.includes(document.id)
          ) {
            await this.db.records.put(await this.row(collection, document));
            changed = true;
          }
        }
        // Adopt legacy replicas once, even when the first pull is an empty
        // heartbeat; later empty pulls keep the stable revision.
        if (changed || !(await this.db.syncState.get(collection))?.dataRevision)
          await this.touch(collection);
        const prior = await this.db.syncState.get(collection);
        await this.db.syncState.put({
          collection,
          dataRevision: prior?.dataRevision,
          cursor: batch.cursor,
          hydrated: (!batch.reset && prior?.hydrated) || !batch.hasMore,
          lastSyncedAt: Date.now(),
        });
      },
    );
  }
  async acknowledge(mutation: Mutation, master: CrmRecord) {
    if (mutation.bundle)
      throw new Error("Acknowledge the complete bundle instead");
    await this.db.transaction(
      "rw",
      [this.db.records, this.db.syncState, this.db.outbox, this.db.collections],
      async () => {
        const current = await this.db.outbox.get(mutation.mutationId);
        if (!current || current.quarantined) return;
        await this.db.outbox.delete(mutation.mutationId);
        const later = (
          await this.db.outbox
            .where("[collection+id]")
            .equals([mutation.collection, mutation.id])
            .toArray()
        )
          .filter((m) => !m.quarantined)
          .sort((a, b) => a.sequence - b.sequence);
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
        await this.touch(mutation.collection);
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
      [this.db.outbox, this.db.conflicts],
      async () => {
        const current = await this.db.outbox.get(mutation.mutationId);
        if (!current || current.quarantined) return;
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
      [
        this.db.records,
        this.db.syncState,
        this.db.outbox,
        this.db.conflicts,
        this.db.collections,
      ],
      async () => {
        const mutation = await this.db.outbox.get(mutationId);
        if (mutation?.bundle)
          throw new Error("Resolve the complete bundle instead");
        const conflict = await this.db.conflicts.get(mutationId);
        if (mutation?.quarantined)
          throw new Error("Pending work is quarantined after an access change");
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
            .filter((m) => !m.quarantined)
            .sortBy("sequence");
          if (later[0])
            await this.rejectMutation(
              later[0],
              "conflict",
              "Server record no longer exists",
              null,
            );
          else if (
            await this.db.records
              .where(":id")
              .equals([mutation.collection, mutation.id])
              .delete()
          )
            await this.touch(mutation.collection);
        } else await this.acknowledge(mutation, conflict.master);
        await this.db.conflicts.delete(mutationId);
      },
    );
  }
  async retryWithLocal(mutationId: string) {
    await this.db.transaction(
      "rw",
      [
        this.db.records,
        this.db.syncState,
        this.db.outbox,
        this.db.conflicts,
        this.db.collections,
      ],
      async () => {
        const mutation = await this.db.outbox.get(mutationId);
        if (!mutation) return;
        if (mutation.bundle)
          throw new Error("Resolve the complete bundle instead");
        if (mutation.quarantined)
          throw new Error("Pending work is quarantined after an access change");
        const metadata = await this.db.collections.get(mutation.collection);
        if (metadata?.capability !== "read-write")
          throw new Error("Collection is not writable locally");
        if (mutation?.bundle)
          throw new Error("Resolve the complete bundle instead");
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
  async acceptPolicy(identity: string) {
    await this.db.transaction(
      "rw",
      [
        this.db.records,
        this.db.collections,
        this.db.syncState,
        this.db.outbox,
        this.db.conflicts,
        this.db.linkSnapshots,
      ],
      async () => {
        const previous = await this.db.syncState.get("$policy");
        if (previous?.policyIdentity === identity) return;
        await this.db.outbox.toCollection().modify({
          quarantined: true,
          state: "error",
          error: "Permissions changed; pending work is quarantined",
        });
        await this.db.records.clear();
        await this.db.linkSnapshots.clear();
        await this.db.collections.clear();
        await this.db.conflicts.clear();
        await this.db.syncState.clear();
        await this.db.syncState.put({
          collection: "$policy",
          hydrated: false,
          policyIdentity: identity,
        });
      },
    );
  }
  async authorizationError() {
    return (await this.db.syncState.get("$authorization"))?.authorizationError;
  }
  async blockAuthorization(message: string, quarantine = true) {
    await this.db.transaction(
      "rw",
      [
        this.db.records,
        this.db.collections,
        this.db.syncState,
        this.db.outbox,
        this.db.linkSnapshots,
      ],
      async () => {
        const policy = await this.db.syncState.get("$policy");
        const scopedPolicy = Boolean(policy);
        for (const mutation of await this.db.outbox.toArray()) {
          const localSnapshot = await this.get(
            mutation.collection,
            mutation.id,
          );
          await this.db.outbox.update(mutation.mutationId, {
            state:
              mutation.bundle && (!quarantine || !scopedPolicy)
                ? mutation.state
                : mutation.state === "conflict"
                  ? "conflict"
                  : "error",
            error: message,
            ...(scopedPolicy && quarantine ? { quarantined: true } : {}),
            localSnapshot: localSnapshot ?? mutation.localSnapshot,
          });
        }
        await this.db.records.clear();
        await this.db.linkSnapshots.clear();
        await this.db.collections.clear();
        await this.db.syncState.clear();
        if (policy) await this.db.syncState.put(policy);
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
      [
        this.db.records,
        this.db.syncState,
        this.db.collections,
        this.db.outbox,
        this.db.conflicts,
      ],
      async () => {
        const mutation = await this.db.outbox.get(mutationId);
        if (!mutation) return;
        if (mutation.bundle)
          throw new Error("Resolve the complete bundle instead");
        if (mutation.state === "pending")
          throw new Error("Only rejected mutations can be discarded");
        await this.db.outbox.delete(mutationId);
        await this.db.conflicts.delete(mutationId);
        if (mutation.quarantined) return;
        const later = await this.db.outbox
          .where("[collection+id]")
          .equals([mutation.collection, mutation.id])
          .filter((m) => !m.quarantined)
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
        if (document && metadata && metadata.capability !== "remote") {
          await this.db.records.put(
            await this.row(mutation.collection, document),
          );
          await this.touch(mutation.collection);
        } else if (
          await this.db.records
            .where(":id")
            .equals([mutation.collection, mutation.id])
            .delete()
        ) {
          await this.touch(mutation.collection);
        }
      },
    );
  }
  async retryMutation(mutationId: string, data?: Record<string, unknown>) {
    await this.db.transaction(
      "rw",
      [
        this.db.records,
        this.db.syncState,
        this.db.collections,
        this.db.outbox,
        this.db.conflicts,
      ],
      async () => {
        const mutation = await this.db.outbox.get(mutationId);
        if (!mutation) return;
        if (mutation.bundle)
          throw new Error("Resolve the complete bundle instead");
        if (mutation.quarantined)
          throw new Error("Pending work is quarantined after an access change");
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
            .filter((m) => !m.quarantined)
            .sortBy("sequence")
        ).filter((m) => !m.quarantined && m.sequence > retry.sequence);
        for (const next of later) {
          await this.db.outbox.update(next.mutationId, { before: document });
          document = overlay(document, next);
        }
        await this.db.records.put(
          await this.row(mutation.collection, document),
        );
        await this.touch(mutation.collection);
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
  /** Observe committed record ranges, including writes from other tabs, without loading documents. */
  subscribeQueryChanges(
    listener: (change: {
      current: Set<string>;
      changed: Set<string>;
      authorizationError?: string;
      metadataChanged: boolean;
    }) => void,
  ) {
    let active = true;
    let initialized = false;
    let previous = new Map<string, string>();
    let previousAuthorization: string | undefined;
    let previousManifest = "";
    let queue = Promise.resolve();
    const prefix = `idb://${this.db.name}/`;
    const onMutation = (parts?: ObservabilitySet) => {
      if (
        parts &&
        !Object.keys(parts).some(
          (part) =>
            part.startsWith(`${prefix}records/`) ||
            part.startsWith(`${prefix}collections/`) ||
            part.startsWith(`${prefix}syncState/`),
        )
      )
        return;
      queue = queue
        .then(async () => {
          if (!active) return;
          const [collections, states] = await this.db.transaction(
            "r",
            this.db.collections,
            this.db.syncState,
            () =>
              Promise.all([
                this.db.collections.toArray(),
                this.db.syncState.toArray(),
              ]),
          );
          if (!active) return;
          const authorizationError = states.find(
            (state) => state.collection === "$authorization",
          )?.authorizationError;
          const hydrated = new Map(
            states.map((state) => [state.collection, state.hydrated]),
          );
          const current = new Map(
            collections
              .filter((item) => item.capability !== "remote")
              .map((item) => [
                item.name,
                JSON.stringify([item, hydrated.get(item.name) ?? false]),
              ]),
          );
          const changed = new Set<string>();
          const recordRanges = [
            parts?.[`${prefix}records/`],
            parts?.[`${prefix}records/:dels`],
          ];
          for (const [name, signature] of current) {
            const range = new RangeSet(
              [name, Dexie.minKey],
              [name, Dexie.maxKey],
            );
            if (
              previous.get(name) !== signature ||
              recordRanges.some((keys) => keys && rangesOverlap(keys, range))
            )
              changed.add(name);
          }
          const manifest = JSON.stringify(collections);
          const metadataChanged = previousManifest !== manifest;
          const removed = [...previous.keys()].some(
            (name) => !current.has(name),
          );
          const notify =
            !initialized ||
            changed.size > 0 ||
            removed ||
            metadataChanged ||
            previousAuthorization !== authorizationError;
          initialized = true;
          previous = current;
          previousManifest = manifest;
          previousAuthorization = authorizationError;
          if (notify)
            listener({
              current: new Set(current.keys()),
              changed,
              authorizationError,
              metadataChanged,
            });
        })
        .catch(() => undefined);
    };
    Dexie.on("storagemutated", onMutation);
    onMutation();
    return () => {
      active = false;
      Dexie.on.storagemutated.unsubscribe(onMutation);
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
