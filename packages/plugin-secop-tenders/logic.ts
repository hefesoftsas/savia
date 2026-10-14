import type { PluginApi, PluginCollection } from "@savia/plugin-sdk";

export const COLLECTION = "procurement_opportunities";
export const PAGE_SIZE = 20;
export const MAX_SNAPSHOT_LENGTH = 16_000;

/** Marks late responses from an older query as obsolete. */
export class RequestSequence {
  private current = 0;

  begin() {
    return ++this.current;
  }

  isCurrent(request: number) {
    return request === this.current;
  }

  invalidate() {
    this.current += 1;
  }
}

export type SecopRow = Record<string, unknown> & { id: string };
export type SearchInput = {
  q?: string;
  estado?: string;
  entidad?: string;
  modalidad?: string;
  departamento?: string;
  page?: number;
  perPage?: number;
};
export type SearchPage = {
  data: SecopRow[];
  page: number;
  perPage: number;
  hasNext: boolean;
};
export type InterestStatus =
  | "interested"
  | "evaluating"
  | "preparing"
  | "submitted"
  | "awarded"
  | "discarded";
export type Interest = Record<string, unknown> & {
  id: string;
  _version?: number;
  source_id: string;
  name: string;
  status: InterestStatus;
  monitoring_enabled?: boolean;
  monitoring_checked_at?: string;
  monitoring_error?: string;
};

const aliases = {
  name: [
    "nombre_del_procedimiento",
    "nombre_procedimiento",
    "objeto_del_proceso",
    "name",
  ],
  process_id: ["id_del_proceso", "referencia_del_proceso", "process_id"],
  entity: ["entidad", "nombre_entidad", "entity"],
  department: ["departamento", "departamento_entidad", "department"],
  modality: ["modalidad_de_contratacion", "modalidad", "modality"],
  amount: ["precio_base", "valor_del_contrato", "amount"],
  publication_date: [
    "fecha_de_publicacion_del",
    "fecha_de_publicacion",
    "publication_date",
  ],
  deadline: ["fecha_de_recepcion_de", "fecha_limite", "deadline"],
  source_status: [
    "estado_del_procedimiento",
    "estado_proceso",
    "estado",
    "source_status",
  ],
  source_url: ["urlproceso", "url_proceso", "enlace", "source_url"],
} as const;

function firstValue(row: Record<string, unknown>, names: readonly string[]) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim() !== "")
      return value;
  }
  return undefined;
}

function boundedText(value: unknown, limit = 2_000): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, limit);
}

export function normalizeSecopRow(value: unknown): SecopRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sourceId = firstValue(row, [
    ":id",
    "id",
    "_id",
    "source_id",
    "id_proceso",
  ]);
  if (
    sourceId === undefined ||
    sourceId === null ||
    String(sourceId).trim() === ""
  )
    return null;
  const normalized: SecopRow = { ...row, id: String(sourceId) };
  for (const [target, names] of Object.entries(aliases)) {
    const field = firstValue(row, names);
    if (field !== undefined) {
      normalized[target] =
        target === "source_url"
          ? safeSourceUrl(
              field && typeof field === "object" && !Array.isArray(field)
                ? (field as Record<string, unknown>).url
                : field,
            )
          : field;
    }
  }
  return normalized;
}

function outputRows(output: unknown): unknown[] {
  if (Array.isArray(output)) return output;
  if (!output || typeof output !== "object") return [];
  const record = output as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.items)) return record.items;
  return [];
}

export function normalizeSearchOutput(
  output: unknown,
  input: SearchInput,
): SearchPage {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const perPage = Math.max(
    1,
    Math.min(100, Math.floor(input.perPage ?? PAGE_SIZE)),
  );
  const record =
    output && typeof output === "object"
      ? (output as Record<string, unknown>)
      : {};
  const rows = outputRows(output)
    .map(normalizeSecopRow)
    .filter((row): row is SecopRow => row !== null);
  return {
    data: rows,
    page,
    perPage,
    hasNext:
      typeof record.hasNext === "boolean"
        ? record.hasNext
        : rows.length >= perPage,
  };
}

export async function searchSecop(
  api: PluginApi,
  input: SearchInput,
): Promise<SearchPage> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const perPage = Math.max(
    1,
    Math.min(100, Math.floor(input.perPage ?? PAGE_SIZE)),
  );
  const actionInput: Record<string, unknown> = {};
  for (const key of [
    "q",
    "estado",
    "entidad",
    "modalidad",
    "departamento",
  ] as const) {
    const value = input[key]?.trim();
    if (value) actionInput[key] = value;
  }
  actionInput.page = page;
  actionInput.perPage = perPage;
  const result = await api.actions.execute<unknown>("search", {
    input: actionInput,
  });
  return normalizeSearchOutput(result.output, { page, perPage });
}

/** Reads one record through the package's fixed, read-only MCP detail action. */
export async function getSecopDetail(
  api: PluginApi,
  processId: string,
): Promise<SecopRow | null> {
  const result = await api.actions.execute<unknown>("detail", {
    input: { id_del_proceso: boundedText(processId, 200) },
  });
  return (
    normalizeSearchOutput(result.output, { page: 1, perPage: 1 }).data[0] ??
    null
  );
}

function safeSourceUrl(value: unknown): string {
  const candidate = boundedText(value, 2_000);
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

export function interestValues(row: SecopRow) {
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const bounded = typeof value === "string" ? value.slice(0, 1_000) : value;
    if (
      typeof bounded === "string" ||
      typeof bounded === "number" ||
      typeof bounded === "boolean" ||
      bounded === null
    )
      snapshot[key] = bounded;
    if (JSON.stringify(snapshot).length > MAX_SNAPSHOT_LENGTH)
      delete snapshot[key];
  }
  const amount = parseAmount(row.amount);
  return {
    name:
      boundedText(row.name ?? row.nombre_del_procedimiento, 500) ||
      `SECOP ${row.id}`,
    source_id: String(row.id),
    process_id: boundedText(row.process_id, 200),
    entity: boundedText(row.entity, 500),
    department: boundedText(row.department, 200),
    modality: boundedText(row.modality, 200),
    amount: Number.isFinite(amount) ? amount : null,
    publication_date: boundedText(row.publication_date, 100),
    deadline: boundedText(row.deadline, 100),
    source_status: boundedText(row.source_status, 200),
    source_url: safeSourceUrl(row.source_url),
    status: "interested" as const,
    monitoring_enabled: true,
    priority: "normal",
    owner: "",
    next_follow_up: "",
    notes: "",
    snapshot: JSON.stringify(snapshot),
  };
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value ?? "")
    .trim()
    .replace(/[^\d,.-]/g, "");
  if (!text) return null;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = Math.max(comma, dot);
    text = `${text.slice(0, decimal).replace(/[,.]/g, "")}.${text.slice(decimal + 1)}`;
  } else if (comma >= 0) {
    const decimalDigits = text.length - comma - 1;
    text =
      decimalDigits > 0 && decimalDigits <= 2
        ? `${text.slice(0, comma).replace(/,/g, "")}.${text.slice(comma + 1)}`
        : text.replace(/,/g, "");
  } else if (dot >= 0 && /^(?:-?\d{1,3})(?:\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function isConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return (
    candidate.code === "conflict" ||
    candidate.code === "version_conflict" ||
    candidate.status === 409
  );
}

async function findBySourceId(
  collection: PluginCollection<Interest>,
  sourceId: string,
) {
  const page = await collection.list({
    page: 1,
    perPage: 2,
    filters: {
      conditions: [{ field: "source_id", op: "eq", value: sourceId }],
    },
  });
  return page.data.find((record) => record.source_id === sourceId) ?? null;
}

export async function saveInterest(api: PluginApi, row: SecopRow) {
  const collection = api.collections.collection<Interest>(COLLECTION);
  const existing = await findBySourceId(collection, String(row.id));
  if (existing) return { record: existing, created: false };
  try {
    const record = await collection.create(interestValues(row));
    return { record, created: true };
  } catch (error) {
    if (!isConflict(error)) throw error;
    const raced = await findBySourceId(collection, String(row.id));
    if (raced) return { record: raced, created: false };
    throw error;
  }
}

export async function updateInterest(
  api: PluginApi,
  record: Interest,
  changes: Partial<Interest>,
) {
  if (typeof record._version !== "number")
    throw new Error("This record has no version; reload it before saving.");
  return api.collections
    .collection<Interest>(COLLECTION)
    .update(record.id, changes, {
      version: record._version,
    });
}

/** Conflict metadata is preserved by the sandbox even without host i18n. */
export function isTrackingConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown };
  const code =
    typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  return (
    candidate.status === 409 ||
    code === "version_conflict" ||
    code === "write_conflict"
  );
}
