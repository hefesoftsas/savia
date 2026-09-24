import type { StudioRecord } from "@savia/studio-shared/metadata";
import type { RelationDefinition } from "@savia/studio-shared/relations";
import type {
  RelatedRecordBundle,
  RelatedRecordChanges,
} from "@savia/studio-shared/related-records";
import { api } from "./api";
import { getStudioRuntime } from "./runtime";

export async function saveRelatedRecords(
  object: string,
  data: Record<string, unknown>,
  previous: StudioRecord | undefined,
  relations: RelatedRecordChanges[],
  idempotencyKey: string,
): Promise<StudioRecord> {
  const workspace = getStudioRuntime().localWorkspace;
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
  const result = await api<{ data: StudioRecord }>(
    `/record-bundles/${encodeURIComponent(object)}`,
    "POST",
    input,
    { headers: { "Idempotency-Key": idempotencyKey } },
  );
  return result.data;
}
