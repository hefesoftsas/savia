import { validateRecord, type CrmRecord } from "@savia/crm-shared/metadata";
import type { RelatedRecordBundle } from "@savia/crm-shared/related-records";
import type {
  RelationDefinition,
  RecordRelationGroup,
} from "@savia/crm-shared/relations";
import type { LocalStore } from "./store";
import type { Mutation, BundleMember, LinkSnapshot } from "./contracts";

export function bundleTransaction<T>(s: LocalStore, run: () => Promise<T>) {
  return s.db.transaction(
    "rw",
    [
      s.db.records,
      s.db.collections,
      s.db.syncState,
      s.db.outbox,
      s.db.conflicts,
      s.db.linkSnapshots,
    ],
    run,
  );
}
export async function pendingBundle(
  s: LocalStore,
  collection: string,
  id: string,
) {
  return (await s.db.outbox.toArray()).find((m) =>
    m.bundle?.members.some((r) => r.collection === collection && r.id === id),
  );
}
export async function enqueueBundle(
  s: LocalStore,
  collection: string,
  original: RelatedRecordBundle,
  definitions: RelationDefinition[],
  mutationId: string,
) {
  const input = structuredClone(original);
  return bundleTransaction(s, async () => {
    if (await s.db.outbox.get(mutationId))
      throw new Error("Operation already exists");
    if (
      input.relations.length > 10 ||
      input.relations.reduce((n, r) => n + r.rows.length, 0) > 100
    )
      throw new Error("Bundle exceeds 10 groups or 100 rows");
    const members: BundleMember[] = [];
    const queued = await s.db.outbox.toArray();
    async function member(
      name: string,
      row: {
        id?: string;
        clientId?: string;
        version?: number;
        data?: Record<string, unknown>;
      },
      isParent = false,
    ) {
      const metadata = await s.db.collections.get(name);
      if (
        metadata?.capability !== "read-write" ||
        !(await s.db.syncState.get(name))?.hydrated
      )
        throw new Error(
          "Every bundle collection must be writable and downloaded locally",
        );
      const id = row.id ?? row.clientId ?? crypto.randomUUID();
      if (!row.id) row.clientId = id;
      if (members.some((m) => m.collection === name && m.id === id))
        throw new Error("A bundle cannot contain a record twice");
      if (
        queued.some(
          (m) =>
            (m.collection === name && m.id === id) ||
            m.bundle?.members.some((r) => r.collection === name && r.id === id),
        )
      )
        throw new Error(
          "This record has pending changes; synchronize or resolve them first",
        );
      const before = await s.get(name, id);
      if (row.id && (!before || before.deleted_at))
        throw new Error("Related record is unavailable locally");
      if (!row.id && before) throw new Error("Client record ID already exists");
      if (row.id && row.data === undefined) {
        delete row.version;
        members.push({ collection: name, id, before, document: before! });
        return before!;
      }
      const fields = metadata.object.config.fields;
      const payload = Object.fromEntries(
        Object.entries(row.data ?? {}).filter(([key]) => {
          const field = fields[key];
          return (
            field &&
            !field.readOnly &&
            !field.config?.formula &&
            !field.config?.collectionRelation &&
            (isParent ||
              (!field.config?.relation && field.type !== "R2Attachment"))
          );
        }),
      );
      const validationFields = Object.fromEntries(
        Object.entries(fields).filter(
          ([, field]) => !field.config?.collectionRelation,
        ),
      );
      const object = {
        ...metadata.object,
        config: {
          ...metadata.object.config,
          fields: validationFields,
          fieldOrder: Object.keys(validationFields),
        },
      };
      const values = Object.fromEntries(
        Object.entries({ ...before, ...payload }).filter(
          ([key]) => key in validationFields,
        ),
      );
      const validated = validateRecord(object, values);
      if (Object.keys(validated.errors).length)
        throw new Error(Object.values(validated.errors).join(" "));
      if (!isParent && !before) {
        const nested = validateRecord(metadata.object, {
          ...validated.data,
          ...Object.fromEntries(
            Object.entries(fields)
              .filter(([, f]) => f.config?.collectionRelation)
              .map(([key, f]) => [key, f.config?.multiple ? [] : null]),
          ),
        });
        if (Object.keys(nested.errors).length)
          throw new Error(Object.values(nested.errors).join(" "));
      }
      // Keep patches as patches: defaults and existing nested values belong only to the replica.
      row.data = Object.fromEntries(
        Object.keys(payload).map((key) => [
          key,
          validated.data[key] ?? payload[key],
        ]),
      );
      if (row.id && row.data !== undefined) row.version ??= before?._version;
      const now = new Date().toISOString();
      const document = {
        created_at: now,
        ...before,
        ...validated.data,
        id,
        updated_at: now,
      } as CrmRecord;
      members.push({ collection: name, id, before, document });
      return document;
    }
    const parent = await member(collection, input.record, true);
    const prior = await s.db.linkSnapshots.get([collection, parent.id]);
    const groups: LinkSnapshot["groups"] = structuredClone(prior?.groups ?? []);
    const seen = new Set<string>();
    for (const group of input.relations) {
      const definition = definitions.find((d) => d.id === group.relationId);
      if (
        !definition ||
        definition.storage !== "local" ||
        (definition.sourceObject !== collection &&
          definition.targetObject !== collection) ||
        seen.has(definition.id)
      )
        throw new Error("Invalid local relation definition");
      seen.add(definition.id);
      if (
        (definition.cardinality === "one-to-one" ||
          (definition.cardinality === "one-to-many" &&
            definition.targetObject === collection)) &&
        group.rows.length > 1
      )
        throw new Error("Relation permits one record");
      if (input.record.id && !group.previousIds)
        throw new Error("Complete prior link selection is required");
      const target =
        definition.sourceObject === collection
          ? definition.targetObject
          : definition.sourceObject;
      const ids: string[] = [];
      for (const row of group.rows) ids.push((await member(target, row)).id);
      // Removed links also own their records until the atomic operation completes.
      for (const id of group.previousIds ?? [])
        if (!ids.includes(id)) await member(target, { id });
      const snapshot = { definition, ids };
      const index = groups.findIndex((g) => g.definition.id === definition.id);
      if (index < 0) groups.push(snapshot);
      else groups[index] = snapshot;
    }
    const parentMetadata = (await s.db.collections.get(collection))!;
    const effective: Record<string, unknown> = Object.fromEntries(
      Object.keys(parentMetadata.object.config.fields).map((key) => [
        key,
        parent[key],
      ]),
    );
    for (const [key, field] of Object.entries(
      parentMetadata.object.config.fields,
    )) {
      if (!field.config?.collectionRelation) continue;
      const selected = groups.find(
        (g) => g.definition.id === field.config?.collectionRelation,
      )?.ids;
      if (!selected && input.record.id)
        throw new Error("Complete relation selection is unavailable locally");
      effective[key] = field.config.multiple
        ? (selected ?? [])
        : (selected?.[0] ?? null);
    }
    const parentValidation = validateRecord(parentMetadata.object, effective);
    if (Object.keys(parentValidation.errors).length)
      throw new Error(Object.values(parentValidation.errors).join(" "));
    const mutation: Mutation = {
      mutationId,
      collection,
      id: parent.id,
      action: "bundle",
      sequence: queued.reduce((n, m) => Math.max(n, m.sequence), 0) + 1,
      state: "pending",
      before: members[0].before,
      bundle: {
        input,
        definitions: structuredClone(definitions),
        members,
        groups,
      },
    };
    for (const m of members) {
      if (m.collection !== collection || m.id !== parent.id)
        await s.db.linkSnapshots.delete([m.collection, m.id]);
      await s.db.records.put(await s.row(m.collection, m.document));
      await s.touch(m.collection);
    }
    await s.db.linkSnapshots.put({ collection, id: parent.id, groups });
    await s.db.outbox.add(mutation);
    return { ...parent, _localPending: true };
  });
}
export async function acknowledgeBundle(
  s: LocalStore,
  mutation: Mutation,
  result: {
    data: CrmRecord;
    related: Array<{ relationId: string; records: CrmRecord[] }>;
  },
) {
  return bundleTransaction(s, async () => {
    const current = await s.db.outbox.get(mutation.mutationId);
    if (!current?.bundle) return;
    // A response arriving after access was revoked must not reveal hidden replicas.
    for (const member of current.bundle.members)
      if (
        (await s.db.collections.get(member.collection))?.capability !==
        "read-write"
      )
        return;
    const requested = current.bundle.input.relations;
    if (
      !result?.data ||
      result.data.id !== current.id ||
      !Array.isArray(result.related) ||
      result.related.length !== requested.length ||
      new Set(result.related.map((g) => g.relationId)).size !== requested.length
    )
      throw new Error("Incomplete bundle acknowledgement");
    for (const request of requested) {
      const received = result.related.find(
        (g) => g.relationId === request.relationId,
      );
      const expected = request.rows.map((r) => r.id ?? r.clientId);
      if (
        !received ||
        !Array.isArray(received.records) ||
        received.records.length !== expected.length ||
        new Set(received.records.map((r) => r.id)).size !== expected.length ||
        received.records.some((r) => !expected.includes(r.id))
      )
        throw new Error("Incomplete bundle acknowledgement");
    }
    const groups = structuredClone(current.bundle.groups);
    await s.db.records.put(await s.row(current.collection, result.data));
    await s.touch(current.collection);
    for (const group of result.related) {
      const definition = current.bundle.definitions.find(
        (d) => d.id === group.relationId,
      );
      if (!definition) throw new Error("Unknown acknowledged relation");
      const target =
        definition.sourceObject === current.collection
          ? definition.targetObject
          : definition.sourceObject;
      for (const record of group.records) {
        await s.db.records.put(await s.row(target, record));
        await s.db.linkSnapshots.delete([target, record.id]);
      }
      await s.touch(target);
      const snapshot = groups.find((g) => g.definition.id === definition.id);
      if (snapshot) snapshot.ids = group.records.map((r) => r.id);
    }
    await s.db.linkSnapshots.put({
      collection: current.collection,
      id: current.id,
      groups,
    });
    await s.db.outbox.delete(current.mutationId);
    await s.db.conflicts.delete(current.mutationId);
  });
}
export async function resolveBundle(
  s: LocalStore,
  mutationId: string,
  mode: "server" | "local",
  masters: Array<{
    collection: string;
    id: string;
    document: CrmRecord | null;
  }>,
  groups: RecordRelationGroup[],
) {
  return bundleTransaction(s, async () => {
    const mutation = await s.db.outbox.get(mutationId);
    if (!mutation?.bundle) throw new Error("Bundle is no longer available");
    if (mutation.state === "pending")
      throw new Error(
        "Wait for a definitive rejection before resolving this bundle",
      );
    for (const member of mutation.bundle.members) {
      const metadata = await s.db.collections.get(member.collection);
      if (
        !metadata ||
        metadata.capability === "remote" ||
        (mode === "local" && metadata.capability !== "read-write")
      )
        throw new Error("Bundle collection access unavailable");
      const master = masters.find(
        (m) => m.collection === member.collection && m.id === member.id,
      );
      if (!master) throw new Error("Complete server records are required");
      if (
        mode === "local" &&
        member.before &&
        (!master.document || master.document.deleted_at)
      )
        throw new Error(
          "A server record was deleted; restore it online before retrying",
        );
    }
    for (const relation of mutation.bundle.input.relations) {
      const group = groups.find((g) => g.definition.id === relation.relationId);
      if (!group || group.total !== group.records.length)
        throw new Error("Complete server links are required");
    }
    const snapshots = groups
      .filter((g) => g.total === g.records.length)
      .map((g) => ({
        definition: g.definition,
        ids: g.records.map((r) => r.id),
      }));
    await s.db.outbox.delete(mutationId);
    await s.db.conflicts.delete(mutationId);
    for (const member of mutation.bundle.members) {
      const master = masters.find(
        (m) => m.collection === member.collection && m.id === member.id,
      )!;
      if (master.document)
        await s.db.records.put(await s.row(member.collection, master.document));
      else await s.db.records.delete([member.collection, member.id]);
      await s.touch(member.collection);
    }
    await s.db.linkSnapshots.put({
      collection: mutation.collection,
      id: mutation.id,
      groups: snapshots,
    });
    if (mode === "local") {
      const input = structuredClone(mutation.bundle.input);
      const rebase = (
        collection: string,
        row: { id?: string; version?: number; data?: Record<string, unknown> },
      ) => {
        if (row.id && row.data !== undefined)
          row.version = masters.find(
            (m) => m.collection === collection && m.id === row.id,
          )?.document?._version;
      };
      rebase(mutation.collection, input.record);
      for (const group of input.relations) {
        group.previousIds = snapshots.find(
          (g) => g.definition.id === group.relationId,
        )!.ids;
        const definition = mutation.bundle.definitions.find(
          (d) => d.id === group.relationId,
        )!;
        for (const row of group.rows)
          rebase(
            definition.sourceObject === mutation.collection
              ? definition.targetObject
              : definition.sourceObject,
            row,
          );
      }
      await enqueueBundle(
        s,
        mutation.collection,
        input,
        mutation.bundle.definitions,
        crypto.randomUUID(),
      );
    }
  });
}
