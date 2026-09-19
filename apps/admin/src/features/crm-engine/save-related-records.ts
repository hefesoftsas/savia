import type { CrmRecord } from "@savia/crm-shared/metadata";
import type { RelationDefinition } from "@savia/crm-shared/relations";
import type {
  RelatedRecordBundle,
  RelatedRecordChanges,
} from "@savia/crm-shared/related-records";
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
  const input: RelatedRecordBundle = {
    record: {
      data,
      ...(previous ? { id: previous.id, version: previous._version } : {}),
    },
    relations,
  };
  if (workspace) {
    const definitions = await api<{ data: RelationDefinition[] }>(
      "/collection-relations",
    );
    const saved = await workspace.store.enqueueBundle(
      object,
      input,
      definitions.data,
      idempotencyKey,
    );
    workspace.requestSync();
    return saved;
  }
  if (navigator.onLine === false)
    throw new Error(
      "El guardado conjunto necesita conexión. Mantén el formulario abierto para conservar tus cambios.",
    );
  const result = await api<{ data: CrmRecord }>(
    `/record-bundles/${encodeURIComponent(object)}`,
    "POST",
    input,
    { headers: { "Idempotency-Key": idempotencyKey } },
  );
  return result.data;
}
