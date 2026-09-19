import type { CrmRecord } from "@savia/crm-shared/metadata";
import type { RecordRelationGroup } from "@savia/crm-shared/relations";
import type { LocalStore } from "./store";
import type { SyncTransport } from "./contracts";

/** Caller holds the scope's Web Lock and supplies the principal-checked transport. */
export async function pushQueuedBundles(
  store: LocalStore,
  transport: SyncTransport,
  requestedCollection?: string,
) {
  const queued = await store.db.outbox.orderBy("sequence").toArray();
  const touched = new Set<string>();
  for (const candidate of queued) {
    if (candidate.action !== "bundle" || !candidate.bundle) continue;
    if (
      requestedCollection &&
      !candidate.bundle.members.some(
        (m) => m.collection === requestedCollection,
      )
    )
      continue;
    const mutation = await store.db.outbox.get(candidate.mutationId);
    if (
      !mutation?.bundle ||
      mutation.quarantined ||
      mutation.state !== "pending"
    )
      continue;
    let unavailable = false;
    for (const member of mutation.bundle.members) {
      const definition = await store.db.collections.get(member.collection);
      if (definition?.capability !== "read-write") {
        unavailable = true;
        break;
      }
    }
    if (unavailable) {
      await store.rejectMutation(
        mutation,
        "error",
        "El formulario contiene una colección sin acceso de escritura local.",
      );
      continue;
    }
    const result = await transport(
      `/api/record-bundles/${encodeURIComponent(mutation.collection)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": mutation.mutationId,
        },
        body: JSON.stringify(mutation.bundle.input),
      },
    );
    if (result.ok) {
      await store.acknowledgeBundle(mutation, await result.json());
      for (const member of mutation.bundle.members)
        touched.add(member.collection);
    } else if (
      result.status === 409 ||
      (result.status >= 400 &&
        result.status < 500 &&
        ![401, 403, 408, 429].includes(result.status))
    ) {
      const body = await result.json().catch(() => undefined);
      const message =
        typeof body?.error === "string"
          ? body.error
          : (body?.error?.message ?? `Bundle sync HTTP ${result.status}`);
      await store.rejectMutation(
        mutation,
        result.status === 409 ? "conflict" : "error",
        message,
      );
    } else throw new Error(`Bundle sync HTTP ${result.status}`);
  }
  return touched;
}

/** Fetch complete links; never turn a partial association page into the baseline. */
export async function fetchCompleteLinks(
  transport: SyncTransport,
  collection: string,
  id: string,
): Promise<RecordRelationGroup[]> {
  const groups = new Map<string, RecordRelationGroup>();
  for (let page = 1; page <= 100; page++) {
    const response = await transport(
      `/api/record-links/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?page=${page}&perPage=100`,
    );
    if (!response.ok)
      throw new Error(
        `No se pudieron cargar los vínculos actuales (${response.status}).`,
      );
    const body = (await response.json()) as { data: RecordRelationGroup[] };
    if (!Array.isArray(body.data))
      throw new Error("Respuesta de vínculos inválida.");
    for (const group of body.data) {
      const existing = groups.get(group.definition.id);
      if (existing && existing.total !== group.total)
        throw new Error(
          "Los vínculos cambiaron durante la lectura. Reintenta.",
        );
      groups.set(group.definition.id, {
        ...group,
        records: [...(existing?.records ?? []), ...group.records],
      });
    }
    if (!body.data.some((group) => group.total > page * 100)) {
      for (const group of groups.values())
        if (new Set(group.records.map((row) => row.id)).size !== group.total)
          throw new Error(
            "La selección de vínculos está incompleta. Reintenta.",
          );
      return [...groups.values()];
    }
  }
  throw new Error(
    "Demasiados vínculos para resolver el formulario de forma segura.",
  );
}
export async function resolveBundleFromServer(
  store: LocalStore,
  transport: SyncTransport,
  mutationId: string,
  mode: "server" | "local",
) {
  const mutation = await store.db.outbox.get(mutationId);
  if (!mutation?.bundle || mutation.quarantined || mutation.action !== "bundle")
    throw new Error("El formulario pendiente ya no está disponible.");
  if (mutation.state === "pending")
    throw new Error(
      "Espera al resultado de la sincronización antes de resolver el formulario.",
    );
  const masters = [];
  for (const member of mutation.bundle.members) {
    const response = await transport(
      `/api/records/${encodeURIComponent(member.collection)}/${encodeURIComponent(member.id)}`,
    );
    if (response.status === 404) {
      masters.push({
        collection: member.collection,
        id: member.id,
        document: null,
      });
      continue;
    }
    if (!response.ok)
      throw new Error(
        `No se pudo cargar el registro actual (${response.status}).`,
      );
    const body = (await response.json()) as { data: CrmRecord };
    if (!body.data || body.data.id !== member.id)
      throw new Error(
        "El registro remoto no coincide con el formulario pendiente.",
      );
    masters.push({
      collection: member.collection,
      id: member.id,
      document: body.data,
    });
  }
  const parent = masters.find(
    (m) => m.collection === mutation.collection && m.id === mutation.id,
  )?.document;
  const groups: RecordRelationGroup[] = parent
    ? await fetchCompleteLinks(transport, mutation.collection, mutation.id)
    : mutation.bundle.input.relations.map((relation) => {
        const definition = mutation.bundle!.definitions.find(
          (d) => d.id === relation.relationId,
        )!;
        const outgoing = definition.sourceObject === mutation.collection;
        return {
          definition,
          direction: outgoing ? "outgoing" : "incoming",
          targetObject: outgoing
            ? definition.targetObject
            : definition.sourceObject,
          targetLabel: outgoing
            ? definition.targetLabel
            : definition.sourceLabel,
          label: outgoing ? definition.targetLabel : definition.sourceLabel,
          records: [],
          total: 0,
          canEdit: true,
        };
      });
  for (const group of groups) {
    if (
      !mutation.bundle.input.relations.some(
        (relation) => relation.relationId === group.definition.id,
      )
    )
      continue;
    for (const record of group.records) {
      if (
        masters.some(
          (master) =>
            master.collection === group.targetObject && master.id === record.id,
        )
      )
        continue;
      const response = await transport(
        `/api/records/${encodeURIComponent(group.targetObject)}/${encodeURIComponent(record.id)}`,
      );
      if (!response.ok)
        throw new Error(
          `No se pudo cargar el registro vinculado actual (${response.status}).`,
        );
      const body = (await response.json()) as { data: CrmRecord };
      if (!body.data || body.data.id !== record.id)
        throw new Error("El registro vinculado remoto no coincide.");
      masters.push({
        collection: group.targetObject,
        id: record.id,
        document: body.data,
      });
    }
  }
  await store.resolveBundle(
    mutationId,
    mode,
    masters,
    groups.filter((group) => group.definition.storage === "local"),
  );
}
