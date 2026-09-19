import type { CrmRecord } from "@savia/crm-shared/metadata";
import type { RelatedRecordChanges } from "@savia/crm-shared/related-records";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";

export async function saveRelatedRecords(
  object: string,
  data: Record<string, unknown>,
  previous: CrmRecord | undefined,
  relations: RelatedRecordChanges[],
  idempotencyKey: string,
): Promise<CrmRecord> {
  const workspace = getCrmRuntime().localWorkspace;
  if (navigator.onLine === false)
    throw new Error(
      workspace
        ? "El guardado conjunto necesita conexión. Tus cambios permanecen en el borrador local."
        : "El guardado conjunto necesita conexión. Mantén el formulario abierto para conservar tus cambios.",
    );
  if (workspace && (await workspace.store.db.outbox.count()) > 0) {
    await workspace.syncNow();
    if ((await workspace.store.db.outbox.count()) > 0)
      throw new Error(
        "Resuelve los cambios pendientes de sincronización antes de guardar el formulario relacionado.",
      );
  }
  const result = await api<{ data: CrmRecord }>(
    `/record-bundles/${encodeURIComponent(object)}`,
    "POST",
    {
      record: {
        data,
        ...(previous ? { id: previous.id, version: previous._version } : {}),
      },
      relations,
    },
    { headers: { "Idempotency-Key": idempotencyKey } },
  );
  if (workspace) {
    // Collection-scoped sync only hydrates missing replicas; a full pass pulls
    // updates for already-loaded parents and every affected child collection.
    // A failed follow-up pull must not turn a committed write into a failed save.
    await workspace.syncNow().catch(() => workspace.requestSync());
  }
  return result.data;
}
