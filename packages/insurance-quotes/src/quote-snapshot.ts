import type { UnifiedQuoteCoverage } from "./plan-profiles";

/**
 * Snapshot normalizado y allowlisted del resultado de un producto.
 * Solo contiene los campos que la UI de oferta/cobertura necesita para
 * renderizar el historial sin depender de `actions.list` recientes.
 * Nunca incluye payloads crudos del proveedor ni datos del solicitante.
 */
export type QuoteResultSnapshot = {
  provider: string;
  productName: string;
  premium: number;
  quoteNumber?: string;
  monthlyInstallment: number;
  score: number;
  badges: string[];
  coverages: UnifiedQuoteCoverage;
  highlights: string[];
};

const COVERAGE_KEYS = [
  "rce",
  "partialLossDeductible",
  "totalLossDeductible",
  "replacementCar",
  "craneAssistance",
  "designatedDriver",
  "medicalExpenses",
  "legalAssistance",
  "workshop",
] as const;

type CoverageKey = (typeof COVERAGE_KEYS)[number];

function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function cleanStringList(value: unknown, maxItems = 10): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item, 200);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanPremium(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return 0;
}

function cleanCoverages(value: unknown): UnifiedQuoteCoverage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const coverages = {} as Record<CoverageKey, string>;
  for (const key of COVERAGE_KEYS) {
    const text = cleanText(rec[key], 200);
    if (!text) return null;
    coverages[key] = text;
  }
  return coverages as UnifiedQuoteCoverage;
}

export type SnapshotSource = {
  provider?: unknown;
  productName?: unknown;
  premium?: unknown;
  quoteNumber?: unknown;
  monthlyInstallment?: unknown;
  score?: unknown;
  badges?: unknown;
  coverages?: unknown;
  highlights?: unknown;
};

/**
 * Construye un snapshot allowlisted desde una oferta unificada ya
 * normalizada (no desde el payload crudo del proveedor).
 */
export function buildResultSnapshot(source: SnapshotSource): QuoteResultSnapshot | null {
  const provider = cleanText(source.provider, 100);
  const productName = cleanText(source.productName, 150);
  const coverages = cleanCoverages(source.coverages);
  if (!provider || !productName || !coverages) return null;
  const premium = cleanPremium(source.premium);
  const quoteNumber = cleanText(source.quoteNumber, 100) ?? undefined;
  const monthlyInstallment =
    typeof source.monthlyInstallment === "number" &&
    Number.isFinite(source.monthlyInstallment) &&
    source.monthlyInstallment >= 0
      ? Math.round(source.monthlyInstallment)
      : premium > 0
        ? Math.round(premium / 12)
        : 0;
  const score =
    typeof source.score === "number" &&
    Number.isFinite(source.score) &&
    source.score >= 0
      ? Math.min(10, source.score)
      : 0;
  return {
    provider,
    productName,
    premium,
    ...(quoteNumber ? { quoteNumber } : {}),
    monthlyInstallment,
    score,
    badges: cleanStringList(source.badges, 10),
    coverages,
    highlights: cleanStringList(source.highlights, 10),
  };
}

export function serializeSnapshot(snapshot: QuoteResultSnapshot): string {
  return JSON.stringify({
    provider: snapshot.provider,
    productName: snapshot.productName,
    premium: snapshot.premium,
    ...(snapshot.quoteNumber ? { quoteNumber: snapshot.quoteNumber } : {}),
    monthlyInstallment: snapshot.monthlyInstallment,
    score: snapshot.score,
    badges: snapshot.badges,
    coverages: snapshot.coverages,
    highlights: snapshot.highlights,
  });
}

/**
 * Parsea un snapshot persistido. Devuelve `null` si el valor no es un
 * snapshot válido (corrupto, con campos faltantes o tipos inválidos).
 * Ignora campos extra para no persistir payloads crudos.
 */
export function parseResultSnapshot(value: unknown): QuoteResultSnapshot | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return buildResultSnapshot(parsed as SnapshotSource);
}
