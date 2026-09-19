import type { PluginApi } from "@savia/crm-shared/plugin-api";
import type { QuoteFormValues } from "./screens/quote-input";

export type ApplicantSourceKey =
  | "fullName"
  | keyof QuoteFormValues["applicant"];

export const APPLICANT_SOURCE_OPTIONS: Array<{
  value: ApplicantSourceKey;
  label: string;
}> = [
  { value: "fullName", label: "Nombre completo" },
  { value: "documentType", label: "Tipo de documento" },
  { value: "documentNumber", label: "Número de documento" },
  { value: "firstName", label: "Nombres" },
  { value: "surname", label: "Primer apellido" },
  { value: "secondSurname", label: "Segundo apellido" },
  { value: "gender", label: "Sexo" },
  { value: "birthDate", label: "Fecha de nacimiento" },
  { value: "city", label: "Ciudad de residencia" },
  { value: "address", label: "Dirección" },
  { value: "phone", label: "Teléfono" },
  { value: "email", label: "Correo electrónico" },
];

export type ClientMapping = {
  collection: string;
  matchField: string;
  fieldMap: Record<string, string>;
};

export const defaultClientMapping: ClientMapping = {
  collection: "clientes",
  matchField: "documento",
  fieldMap: {
    name: "fullName",
    documento: "documentNumber",
    email: "email",
    telefono: "phone",
  },
};

export function resolveApplicantValue(
  applicant: QuoteFormValues["applicant"],
  source: string,
): string {
  if (source === "fullName") {
    return [applicant.firstName, applicant.surname, applicant.secondSurname]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
  }
  const value =
    (applicant as Record<string, unknown>)[source];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Convierte el solicitante del formulario en un registro de la colección
 * configurada según el mapeo. Solo incluye valores no vacíos.
 */
export function buildClientRecord(
  applicant: QuoteFormValues["applicant"],
  mapping: ClientMapping,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [collectionField, source] of Object.entries(mapping.fieldMap)) {
    if (!collectionField.trim() || !source.trim()) continue;
    const value = resolveApplicantValue(applicant, source);
    if (value) record[collectionField] = value;
  }
  return record;
}

function recordId(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

function recordText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function listAllRecords(
  handle: { list: (options?: { page?: number; perPage?: number }) => Promise<{ data: unknown[]; total: number; page: number; perPage: number }> },
): Promise<Array<Record<string, unknown>>> {
  const perPage = 200;
  const first = await handle.list({ page: 1, perPage });
  const pages = Math.min(
    10,
    Math.max(1, Math.ceil(first.total / first.perPage)),
  );
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) =>
      handle.list({ page: index + 2, perPage: first.perPage }),
    ),
  );
  const records: Array<Record<string, unknown>> = [];
  for (const page of [first, ...rest]) {
    for (const item of page.data) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        records.push(item as Record<string, unknown>);
      }
    }
  }
  return records;
}

async function findClientByMatch(
  savia: PluginApi,
  collection: string,
  matchField: string,
  matchValue: string,
): Promise<string | null> {
  const record = await fetchClientByMatch(savia, { collection, matchField }, matchValue);
  return record ? recordId(record) : null;
}

/**
 * Busca un cliente existente por el campo de coincidencia. Devuelve el
 * registro completo o `null`. Lanza si el CRM falla.
 */
export async function fetchClientByMatch(
  savia: PluginApi,
  mapping: Pick<ClientMapping, "collection" | "matchField">,
  matchValue: string,
): Promise<Record<string, unknown> | null> {
  const handle = savia.collections.collection(mapping.collection);
  const records = await listAllRecords(handle);
  const wanted = matchValue.trim();
  return (
    records.find((item) => recordText(item[mapping.matchField]) === wanted) ??
    null
  );
}

/**
 * Fuente del solicitante que alimenta el campo de coincidencia (`null` si el
 * mapeo no lo define sobre un campo real del formulario).
 */
export function matchSourceKey(mapping: ClientMapping): string | null {
  const source = mapping.fieldMap[mapping.matchField]?.trim();
  return source ? source : null;
}

export type ApplyClientResult = {
  applicant: QuoteFormValues["applicant"];
  filled: string[];
};

function isApplicantKey(
  applicant: QuoteFormValues["applicant"],
  key: string,
): key is keyof QuoteFormValues["applicant"] {
  return Object.prototype.hasOwnProperty.call(applicant, key);
}

/**
 * Vuelca un registro CRM sobre el formulario según el mapeo inverso. Solo
 * rellena campos vacíos y nunca borra lo digitado. `fullName` se reparte en
 * nombres y apellidos por palabras.
 */
export function applyClientRecord(
  applicant: QuoteFormValues["applicant"],
  record: Record<string, unknown>,
  mapping: ClientMapping,
): ApplyClientResult {
  const next = { ...applicant };
  const filled: string[] = [];
  for (const [collectionField, source] of Object.entries(mapping.fieldMap)) {
    const raw = recordText(record[collectionField]);
    if (!raw || !source.trim()) continue;
    if (source === "fullName") {
      const [first, second, ...rest] = raw.split(/\s+/).filter(Boolean);
      const parts: Array<[keyof QuoteFormValues["applicant"], string | undefined]> = [
        ["firstName", first],
        ["surname", second],
        ["secondSurname", rest.length ? rest.join(" ") : undefined],
      ];
      for (const [key, value] of parts) {
        if (value && !next[key].trim()) {
          next[key] = value;
          filled.push(key);
        }
      }
      continue;
    }
    if (isApplicantKey(next, source) && !next[source].trim()) {
      next[source] = raw;
      filled.push(source);
    }
  }
  return { applicant: next, filled };
}

export type UpsertClientResult = {
  id: string;
  created: boolean;
};

/**
 * Guarda el solicitante en la colección CRM configurada: actualiza el
 * registro existente (según `matchField`) o crea uno nuevo. Nunca lanza:
 * devuelve `null` cuando no hay nada que guardar o el CRM falla, para no
 * bloquear la cotización.
 */
export async function upsertQuoteClient(
  savia: PluginApi,
  settings: { clientMapping?: ClientMapping | null },
  applicant: QuoteFormValues["applicant"],
): Promise<UpsertClientResult | null> {
  try {
    const mapping = settings.clientMapping;
    if (!mapping?.collection?.trim()) return null;
    const record = buildClientRecord(applicant, mapping);
    if (Object.keys(record).length === 0) return null;
    const handle = savia.collections.collection(mapping.collection);
    const matchValue =
      mapping.matchField.trim() &&
      typeof record[mapping.matchField] === "string"
        ? (record[mapping.matchField] as string).trim()
        : "";
    if (matchValue) {
      const existingId = await findClientByMatch(
        savia,
        mapping.collection,
        mapping.matchField,
        matchValue,
      );
      if (existingId) {
        try {
          await handle.update(existingId, record);
        } catch {
          // Conservar el vínculo aunque la actualización falle.
        }
        return { id: existingId, created: false };
      }
    }
    const created = await handle.create(record);
    const id = recordId(created);
    return id ? { id, created: true } : null;
  } catch {
    return null;
  }
}
