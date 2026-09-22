import {
  pluginIntlLocale,
  type PluginLocale,
} from "@savia/crm-shared/plugin-localization";
import { insuranceMessage } from "../messages";
import type { PluginExtensionActionRun } from "@savia/crm-shared/plugin-api";
import type { QuoteBatchItem } from "./quote-results";
import { defaultProfiles, type UnifiedQuoteCoverage } from "../plan-profiles";

export type { UnifiedQuoteCoverage } from "../plan-profiles";

export type UnifiedComparisonQuote = {
  id: string;
  productId: string;
  flowId: string;
  provider: string;
  productName: string;
  quoteNumber?: string;
  premium: number;
  monthlyInstallment: number;
  score: number;
  badges: string[];
  coverages: UnifiedQuoteCoverage;
  highlights: string[];
  ctaText: string;
  ctaSubtext: string;
  status: "succeeded" | "failed" | "pending";
  detailId?: string;
  error?: string;
  isSimulation?: boolean;
};

export function formatCop(amount: number, locale: PluginLocale = "es"): string {
  return new Intl.NumberFormat(pluginIntlLocale(locale), {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildUnifiedComparisonQuote(
  item: QuoteBatchItem,
  run?: PluginExtensionActionRun,
): UnifiedComparisonQuote {
  const output = run?.output as { data?: { simulated?: boolean } } | undefined;
  const isSimulation =
    run?.connectionId === "simulation" || output?.data?.simulated === true;
  if (!isSimulation) {
    const unavailable = "No informado por la aseguradora";
    return {
      id: item.productId,
      productId: item.productId,
      flowId: item.flowId,
      provider: item.provider,
      productName: item.label.split(" · ")[1] || item.label,
      quoteNumber: item.quoteNumber,
      premium:
        typeof item.premium === "number" &&
        Number.isFinite(item.premium) &&
        item.premium > 0
          ? item.premium
          : 0,
      monthlyInstallment: 0,
      score: 0,
      badges: [item.quoteNumber ? "Cotización recibida" : "Respuesta recibida"],
      coverages: {
        rce: unavailable,
        partialLossDeductible: unavailable,
        totalLossDeductible: unavailable,
        replacementCar: unavailable,
        craneAssistance: unavailable,
        designatedDriver: unavailable,
        medicalExpenses: unavailable,
        legalAssistance: unavailable,
        workshop: unavailable,
      },
      highlights: item.quoteNumber ? [`Cotización: ${item.quoteNumber}`] : [],
      ctaText: "Copiar datos",
      ctaSubtext: "Respuesta de la aseguradora",
      status: item.status,
      detailId: item.detailId,
      error: item.error,
      isSimulation: false,
    };
  }
  const profile = defaultProfiles[item.flowId] ?? {
    provider: item.provider || item.label.split(" · ")[0] || "Seguros",
    productName: item.label.split(" · ")[1] || item.label,
    baseScore: 9.0,
    defaultPremium: 0,
    badges: ["Cotización oficial"],
    coverages: {
      rce: "Según condiciones particulares",
      partialLossDeductible: "Según condiciones",
      totalLossDeductible: "Según condiciones",
      replacementCar: "Según plan",
      craneAssistance: "Asistencia nacional",
      designatedDriver: "Según plan",
      medicalExpenses: "Amparo patrimonial",
      legalAssistance: "Asistencia jurídica 24/7",
      workshop: "Red de talleres autorizados",
    },
    highlights: item.quoteNumber
      ? [`Cotización oficial: ${item.quoteNumber}`]
      : ["Póliza todo riesgo autos"],
    ctaText: "Copiar datos",
    ctaSubtext: "Cotización oficial",
  };

  const premium =
    typeof item.premium === "number" && item.premium > 0
      ? item.premium
      : profile.defaultPremium;

  const monthlyInstallment = premium > 0 ? Math.round(premium / 12) : 0;

  return {
    id: item.productId,
    productId: item.productId,
    flowId: item.flowId,
    provider: item.provider || profile.provider,
    productName: profile.productName,
    quoteNumber: item.quoteNumber,
    premium,
    monthlyInstallment,
    score: profile.baseScore,
    badges: profile.badges,
    coverages: profile.coverages,
    highlights: profile.highlights,
    ctaText: profile.ctaText,
    ctaSubtext: profile.ctaSubtext,
    status: item.status,
    detailId: item.detailId,
    error: item.error,
    isSimulation,
  };
}

/** Localize extension-authored descriptions without changing identifiers or provider responses. */
export function toUnifiedComparisonQuote(
  item: QuoteBatchItem,
  run?: PluginExtensionActionRun,
  locale: PluginLocale = "es",
): UnifiedComparisonQuote {
  const quote = buildUnifiedComparisonQuote(item, run);
  const t = (message: string) => insuranceMessage(message, locale);
  return {
    ...quote,
    badges: quote.badges.map(t),
    coverages: Object.fromEntries(
      Object.entries(quote.coverages).map(([key, value]) => [key, t(value)]),
    ) as UnifiedQuoteCoverage,
    highlights: quote.highlights.map(t),
    ctaText: t(quote.ctaText),
    ctaSubtext: t(quote.ctaSubtext),
  };
}
