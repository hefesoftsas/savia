import {
  createPluginApi,
  type PluginHostRequest,
} from "@savia/studio-shared/plugin-api";
import type { PluginAssistantTaskDraft } from "@savia/studio-shared/plugin-assistant";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export async function createAssistantTaskRecord(
  options: {
    collection: string;
    pluginId: string;
    context: Record<string, unknown>;
    sourceUrl: string;
    request: PluginHostRequest;
  },
  draft: PluginAssistantTaskDraft,
): Promise<{ id: string; created: boolean }> {
  if (
    !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(options.collection) ||
    !draft.title.trim() ||
    draft.title.length > 200 ||
    !draft.assignee.trim() ||
    draft.assignee.length > 120 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) ||
    !Number.isFinite(Date.parse(draft.dueDate)) ||
    new Date(draft.dueDate).toISOString().slice(0, 10) !== draft.dueDate ||
    !draft.suggestion.id ||
    draft.suggestion.id.length > 256 ||
    draft.suggestion.description.length > 20000 ||
    draft.sourceReference.length > 20000
  )
    throw new Error(
      "A title, responsible person and valid due date are required.",
    );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify(
        canonical([
          options.pluginId,
          options.collection,
          options.context,
          draft.suggestion.id,
        ]),
      ),
    ),
  );
  const sourceKey = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const collection = createPluginApi({
    extensionId: options.pluginId,
    request: options.request,
  }).collections.collection<{ id: string; source_key: string }>(
    options.collection,
  );
  const find = async () =>
    (
      await collection.list({
        perPage: 2,
        filters: {
          conditions: [{ field: "source_key", op: "eq", value: sourceKey }],
        },
      })
    ).data.find((r) => r.source_key === sourceKey);
  const existing = await find();
  if (existing) return { id: existing.id, created: false };
  try {
    const record = await collection.create({
      name: draft.title.trim(),
      description: draft.suggestion.description,
      assignee: draft.assignee.trim(),
      due_date: draft.dueDate,
      status: "open",
      source_key: sourceKey,
      source_context: JSON.stringify({
        pluginId: options.pluginId,
        context: options.context,
        requirementId: draft.suggestion.id,
      }),
      source_reference: draft.sourceReference,
      source_url: options.sourceUrl,
    } as never);
    return { id: record.id, created: true };
  } catch (error) {
    // A concurrent submit or an uncertain acknowledgement must reuse the record.
    const raced = await find();
    if (raced) return { id: raced.id, created: false };
    throw error;
  }
}
