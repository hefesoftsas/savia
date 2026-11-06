import type { PluginApi } from "@savia/studio-shared/plugin-api";
export type IntegrationRecord = Record<string, unknown> & {
  id: string;
  _version?: number;
};
export async function saveIntegrationRecord(
  savia: PluginApi,
  object: string,
  input: Record<string, unknown>,
  existing?: IntegrationRecord,
) {
  const collection = savia.collections.collection<IntegrationRecord>(object);
  if (!existing) return collection.create(input);
  if (!Number.isInteger(existing._version) || existing._version! < 1)
    throw Error("Vuelve a cargar el registro para obtener su versión.");
  return collection.update(existing.id, input, { version: existing._version });
}
