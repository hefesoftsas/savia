import { parseResultSnapshot } from "./quote-snapshot";
import type { QuoteBatchItem } from "./screens/quote-results";

type DetailRecord = Record<string, unknown> & { id: string };

type DetailCollectionHandle = {
  get?: (id: string) => Promise<unknown>;
  list: (options?: {
    page?: number;
    perPage?: number;
    sort?: string;
    order?: "ASC" | "DESC";
    filters?: {
      logic?: "and" | "or";
      conditions: Array<{ field: string; op: string; value?: unknown }>;
    };
  }) => Promise<{
    data: unknown[];
    total: number;
    page: number;
    perPage: number;
  }>;
  remove: (id: string, options?: { version?: number }) => Promise<void>;
};

function storedNumber(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function storedText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function recordVersion(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const version = (value as Record<string, unknown>)._version;
  return typeof version === "number" && Number.isInteger(version) && version > 0
    ? version
    : undefined;
}

function detailStatus(
  value: unknown,
  quoteNumber: string | undefined,
  premium: number | undefined,
): QuoteBatchItem["status"] {
  const normalized =
    typeof value === "string" ? value.trim().toLocaleLowerCase("es-CO") : "";
  if (
    ["error", "fallida", "fallido", "rechazada", "rechazado"].includes(
      normalized,
    )
  ) {
    return "failed";
  }
  if (
    [
      "recibida",
      "recibido",
      "cotizada",
      "cotizado",
      "completada",
      "completado",
      "exitosa",
      "exitoso",
      "success",
      "succeeded",
    ].includes(normalized) ||
    quoteNumber ||
    (premium !== undefined && premium > 0)
  ) {
    return "succeeded";
  }
  return "pending";
}

function toDetailRecords(items: unknown[]): DetailRecord[] {
  const all: DetailRecord[] = [];
  for (const item of items ?? []) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (typeof rec.id === "string") all.push({ ...rec, id: rec.id });
    }
  }
  return all;
}

function detailMatchesQuote(
  detail: DetailRecord,
  quoteId: string,
  quoteReference?: string,
): boolean {
  const raw = detail.cotizacion;
  const candidates = [quoteId, quoteReference].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const relationId =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).id
      : raw;
  if (relationId != null && String(relationId).trim()) {
    return candidates.some(
      (candidate) => String(relationId).trim() === candidate.trim(),
    );
  }
  // Names recover orphaned legacy details only. An explicit foreign relation
  // always wins, preventing deletion of a copied detail belonging to another quote.
  if (quoteReference && typeof detail.name === "string") {
    const name = detail.name.trim();
    const ref = quoteReference.trim();
    if (name === ref || name.startsWith(`${ref}-`)) return true;
  }
  return false;
}

async function listFiltered(
  detailColl: DetailCollectionHandle,
  filters:
    | {
        logic?: "and" | "or";
        conditions: Array<{ field: string; op: string; value?: unknown }>;
      }
    | undefined,
  perPage: number,
): Promise<DetailRecord[]> {
  const first = await detailColl.list({ page: 1, perPage, filters });
  const all = toDetailRecords(first.data ?? []);
  const total = typeof first.total === "number" ? first.total : all.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, index) =>
        detailColl.list({ page: index + 2, perPage, filters }),
      ),
    );
    for (const page of rest) {
      all.push(...toDetailRecords(page.data ?? []));
    }
  }
  return all;
}

/**
 * Lee solo los detalles del master indicado usando un filtro server-side
 * (`cotizacion eq quoteId`, o `or` con la referencia histórica). Pagina la
 * respuesta filtrada en lugar de recorrer toda la colección.
 *
 * Si el filtro server-side falla (campo desconocido en esquemas viejos,
 * colección aún sin hidratar en el transporte local) o devuelve vacío por
 * diferencias de formato (espacios, referencia guardada en `name`), cae a
 * un barrido paginado con coincidencia tolerante en cliente para no dejar
 * la cotización sin detalles ni sin borrado.
 */
export async function fetchDetailsForQuote(
  detailColl: DetailCollectionHandle,
  quoteId: string,
  quoteReference?: string,
): Promise<DetailRecord[]> {
  const conditions =
    quoteReference && quoteReference !== quoteId
      ? {
          logic: "or" as const,
          conditions: [
            { field: "cotizacion", op: "eq", value: quoteId },
            { field: "cotizacion", op: "eq", value: quoteReference },
          ],
        }
      : {
          logic: "and" as const,
          conditions: [{ field: "cotizacion", op: "eq", value: quoteId }],
        };
  const perPage = 200;
  try {
    const filtered = await listFiltered(detailColl, conditions, perPage);
    if (filtered.length > 0)
      return filtered.filter((detail) =>
        detailMatchesQuote(detail, quoteId, quoteReference),
      );
  } catch {
    // El filtro server-side no está disponible: continuar con el respaldo.
  }
  // Respaldo: barrido paginado (acotado para no recorrer colecciones enormes)
  // con coincidencia tolerante en cliente.
  const fallback: DetailRecord[] = [];
  const maxPages = 10;
  for (let page = 1; page <= maxPages; page += 1) {
    const chunk = await detailColl.list({ page, perPage });
    const records = toDetailRecords(chunk.data ?? []);
    for (const record of records) {
      if (detailMatchesQuote(record, quoteId, quoteReference)) {
        fallback.push(record);
      }
    }
    const total =
      typeof chunk.total === "number" ? chunk.total : records.length;
    if (page * perPage >= total || records.length === 0) break;
    // Si ya encontramos todo lo filtrado y el total sugiere que no hay más
    // páginas relevantes, no seguimos escaneando.
    if (fallback.length > 0 && chunk.data.length < perPage) break;
  }
  return fallback;
}

export function mapDetailToBatchItem(
  d: DetailRecord,
  staleMessage: string,
  now = Date.now(),
): QuoteBatchItem {
  const quoteNumber = storedText(d.numero_cotizacion);
  const premium = storedNumber(d.prima);
  const recordedStatus = detailStatus(d.estado, quoteNumber, premium);
  const updatedAt =
    typeof d.updated_at === "string" ? Date.parse(d.updated_at) : NaN;
  const createdAt =
    typeof d.created_at === "string" ? Date.parse(d.created_at) : NaN;
  const pendingSince = Number.isFinite(updatedAt) ? updatedAt : createdAt;
  const stale =
    recordedStatus === "pending" &&
    (!Number.isFinite(pendingSince) || now - pendingSince > 5 * 60_000);
  const snapshotRaw =
    typeof d.resultado_snapshot === "string" ? d.resultado_snapshot : undefined;
  const snapshot = snapshotRaw
    ? (parseResultSnapshot(snapshotRaw) ?? undefined)
    : undefined;
  const durationMs =
    typeof d.duracion_ms === "number" &&
    Number.isFinite(d.duracion_ms) &&
    d.duracion_ms >= 0
      ? Math.round(d.duracion_ms)
      : undefined;
  return {
    productId: String(d.producto || d.id),
    flowId: String(d.flow_id || d.producto || d.id),
    label: String(d.producto || d.name || "Póliza"),
    provider: String(d.aseguradora || "Aseguradora"),
    status: stale ? "failed" : recordedStatus,
    error: stale
      ? staleMessage
      : typeof d.error_mensaje === "string"
        ? d.error_mensaje
        : undefined,
    detailId: String(d.id),
    detailVersion: recordVersion(d),
    runId: storedText(d.run_id),
    quoteNumber,
    premium,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(snapshot ? { snapshot } : {}),
  };
}

export type DeleteQuoteHistoryResult =
  | { ok: true; deletedDetails: number }
  | {
      ok: false;
      failedDetailId: string;
      error: string;
      deletedDetails: number;
    };

/**
 * Elimina el historial en orden de dependencias: primero todos los detalles
 * hijos, luego el master. Si un hijo falla, conserva el master para
 * recuperación y reporta el fallo sin ocultar el master.
 *
 * Tolera versiones ausentes (transporte local) y reintenta el master cuando
 * el backend bloquea por relaciones que quedaron sin barrer en el primer
 * intento.
 */
export async function deleteQuoteHistory(
  detailColl: DetailCollectionHandle,
  masterColl: {
    get?: (id: string) => Promise<unknown>;
    remove: (id: string, options?: { version?: number }) => Promise<void>;
  },
  quoteId: string,
  masterVersion: number | undefined,
  quoteReference?: string,
): Promise<DeleteQuoteHistoryResult> {
  let details: DetailRecord[];
  try {
    details = await fetchDetailsForQuote(detailColl, quoteId, quoteReference);
  } catch (reason) {
    return {
      ok: false,
      failedDetailId: "",
      error:
        reason instanceof Error && reason.message
          ? reason.message
          : "No se pudieron leer los detalles.",
      deletedDetails: 0,
    };
  }
  let deleted = 0;
  const deleteOneDetail = async (detail: DetailRecord) => {
    // Resolve the current version immediately before deletion. Never retry
    // without a version: the API requires optimistic concurrency protection.
    const version = detailColl.get
      ? recordVersion(await detailColl.get(detail.id))
      : recordVersion(detail);
    if (version === undefined) {
      await detailColl.remove(detail.id);
    } else {
      await detailColl.remove(detail.id, { version });
    }
    deleted += 1;
  };
  for (const detail of details) {
    try {
      await deleteOneDetail(detail);
    } catch (reason) {
      return {
        ok: false,
        failedDetailId: detail.id,
        error:
          reason instanceof Error && reason.message
            ? reason.message
            : "No se pudo eliminar un detalle.",
        deletedDetails: deleted,
      };
    }
  }
  const removeMaster = async () => {
    if (masterColl.get) {
      masterVersion = recordVersion(await masterColl.get(quoteId));
    }
    if (masterVersion === undefined) {
      await masterColl.remove(quoteId);
    } else {
      await masterColl.remove(quoteId, { version: masterVersion });
    }
  };
  try {
    await removeMaster();
  } catch (reason) {
    const message =
      reason instanceof Error && reason.message ? reason.message : "";
    // El backend bloquea el master mientras queden hijos (`Hay relaciones…`).
    // Rebarre con el fallback tolerante y reintenta una vez antes de fallar.
    if (/relacion/i.test(message)) {
      try {
        const remaining = await fetchDetailsForQuote(
          detailColl,
          quoteId,
          quoteReference,
        );
        for (const detail of remaining) {
          await deleteOneDetail(detail);
        }
        await removeMaster();
        return { ok: true, deletedDetails: deleted };
      } catch (retryReason) {
        return {
          ok: false,
          failedDetailId: quoteId,
          error:
            retryReason instanceof Error && retryReason.message
              ? retryReason.message
              : message || "No se pudo eliminar la cotización.",
          deletedDetails: deleted,
        };
      }
    }
    return {
      ok: false,
      failedDetailId: quoteId,
      error: message || "No se pudo eliminar la cotización.",
      deletedDetails: deleted,
    };
  }
  return { ok: true, deletedDetails: deleted };
}
