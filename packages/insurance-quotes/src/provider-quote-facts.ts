import type { PublicQuoteFact } from "@savia/studio-shared/public-quote";

const MAX_FACTS = 40;
const COVERAGE_LABELS = {
  rce: "Responsabilidad civil (RCE)",
  partialLossDeductible: "Deducible por pérdida parcial",
  totalLossDeductible: "Deducible por pérdida total",
  replacementCar: "Vehículo de reemplazo",
  craneAssistance: "Grúa",
  designatedDriver: "Conductor elegido",
  medicalExpenses: "Gastos médicos",
  legalAssistance: "Asistencia jurídica",
  workshop: "Taller",
  partialLoss: "Pérdida parcial",
  totalLoss: "Pérdida total",
  roadsideAssistance: "Asistencia en carretera",
} as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return;
  const text = value.trim();
  if (
    !text ||
    text.length > max ||
    /https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+|[<>\x00-\x1f]/i.test(text)
  )
    return;
  return text;
}

function number(value: unknown): number | undefined {
  const candidate =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(candidate) && candidate >= 0 && candidate <= 1e12
    ? candidate
    : undefined;
}

/** Shared projection for WhatsApp and public forms; never copies a raw response. */
export function extractProviderQuoteFacts(value: unknown): PublicQuoteFact[] {
  const source = record(value);
  if (!source || source.simulated === true) return [];
  const facts: PublicQuoteFact[] = [];
  const append = (label: string, text: string) => {
    if (facts.length >= MAX_FACTS || text.length > 250) return;
    if (facts.some((fact) => fact.label === label && fact.value === text))
      return;
    facts.push({ label, value: text, source: "provider" });
  };
  const coverages = record(source.coverages);
  for (const [key, label] of Object.entries(COVERAGE_LABELS)) {
    const raw = coverages?.[key];
    const text =
      typeof raw === "number" && Number.isFinite(raw)
        ? String(raw)
        : typeof raw === "boolean"
          ? raw
            ? "Incluido"
            : "No incluido"
          : safeText(raw, 250);
    if (text) append(label, text);
  }

  // Flows may expose canonical coverageDetails. Existing provider flows return
  // the same breakdown under response.amparo; adapt only these known fields.
  const breakdowns = [
    {
      items: source.coverageDetails,
      label: "label",
      capital: "limit",
      deductibles: ["deductible"],
    },
    {
      items: record(source.response)?.amparo,
      label: "nombre",
      capital: "capital",
      deductibles: ["tdeducible", "deducible"],
    },
  ];
  for (const mapping of breakdowns) {
    if (!Array.isArray(mapping.items)) continue;
    for (const item of mapping.items.slice(0, 100)) {
      const row = record(item);
      const label = safeText(row?.[mapping.label], 100);
      if (!label || !/\p{L}/u.test(label)) continue;
      const capital = number(row?.[mapping.capital]);
      const deductible = mapping.deductibles
        .map((key) => {
          const raw = row?.[key];
          return typeof raw === "number"
            ? number(raw)?.toString()
            : safeText(raw, 150);
        })
        .find((text) => text !== undefined);
      if (capital === undefined && deductible === undefined) continue;
      const parts = [
        capital === undefined
          ? "Capital no informado"
          : `Capital informado: $${capital.toLocaleString("es-CO")} COP`,
        deductible === undefined
          ? "deducible no informado"
          : `deducible: ${deductible}`,
      ];
      append(label, parts.join("; "));
    }
  }
  return facts;
}
