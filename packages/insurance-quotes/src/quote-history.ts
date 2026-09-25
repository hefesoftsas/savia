import { parseResultSnapshot } from "./quote-snapshot";
import type { QuoteBatchItem } from "./screens/quote-results";

type DetailRecord = Record<string, unknown> & { id: string };

type DetailCollectionHandle = {
  list: (options?: {
    page?: number;
    perPage?: number;
    sort?: string;
    order?: "ASC" | "DESC";
    filters?: { logic?: "and" | "or"; conditions: Array<{ field: string; op: string; value?: unknown }> };
  }) => Promise<{ data: unknown[]; total: number; page: number; perPage: number }>;
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
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
  const normalized = typeof value === "string" ? value.trim().toLocaleLowerCase("es-CO") : "";
  if (["error", "fallida", "fallido", "rechazada", "rechazado"].includes(normalized)) {
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

/**
 * Lee solo los detalles del master indicado usando un filtro server-side
 * (`cotizacion eq quoteId`, o `or` con la referencia histórica). Pagina la
 * respuesta filtrada en lugar de recorrer toda la colección.
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
  const first = await detailColl.list({ page: 1, perPage, filters: conditions });
  const all: DetailRecord[] = [];
  for (const item of first.data ?? []) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (typeof rec.id === "string") all.push({ ...rec, id: rec.id });
    }
  }
  const total = typeof first.total === "number" ? first.total : all.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, index) =>
        detailColl.list({ page: index + 2, perPage, filters: conditions }),
      ),
    );
    for (const page of rest) {
      for (const item of page.data ?? []) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const rec = item as Record<string, unknown>;
          if (typeof rec.id === "string") all.push({ ...rec, id: rec.id });
        }
      }
    }
  }
  return all;
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
    typeof d.updated_at === "string"
      ? Date.parse(d.updated_at)
      : typeof d.created_at === "string"
        ? Date.parse(d.created_at)
        : NaN;
  const stale =
    recordedStatus === "pending" &&
    Number.isFinite(updatedAt) &&
    now - updatedAt > 5 * 60_000;
  const snapshotRaw =
    typeof d.resultado_snapshot === "string" ? d.resultado_snapshot : undefined;
  const snapshot = snapshotRaw ? parseResultSnapshot(snapshotRaw) ?? undefined : undefined;
  const durationMs =
    typeof d.duracion_ms === "number" && Number.isFinite(d.duracion_ms) && d.duracion_ms >= 0
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
  | { ok: false; failedDetailId: string; error: string; deletedDetails: number };

/**
 * Elimina el historial en orden de dependencias: primero todos los detalles
 * hijos, luego el master. Si un hijo falla, conserva el master para
 * recuperación y reporta el fallo sin ocultar el master.
 */
export async function deleteQuoteHistory(
  detailColl: DetailCollectionHandle,
  masterColl: { remove: (id: string, options?: { version?: number }) => Promise<void> },
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
      error: reason instanceof Error && reason.message ? reason.message : "No se pudieron leer los detalles.",
      deletedDetails: 0,
    };
  }
  let deleted = 0;
  for (const detail of details) {
    try {
      await detailColl.remove(detail.id, { version: recordVersion(detail) });
      deleted += 1;
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
  try {
    await masterColl.remove(quoteId, { version: masterVersion });
  } catch (reason) {
    return {
      ok: false,
      failedDetailId: quoteId,
      error:
        reason instanceof Error && reason.message
          ? reason.message
          : "No se pudo eliminar la cotización.",
      deletedDetails: deleted,
    };
  }
  return { ok: true, deletedDetails: deleted };
}
