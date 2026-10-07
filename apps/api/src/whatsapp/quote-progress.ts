import type { InsuranceQuoteProgress } from "@savia/release-catalog/assistant-operations";

export function quoteProgressText(progress: InsuranceQuoteProgress): string {
  if (
    progress.state !== "priced" ||
    typeof progress.premium !== "number" ||
    !Number.isFinite(progress.premium) ||
    progress.premium <= 0
  )
    return "";
  return `${progress.product}\nPrima: $${progress.premium.toLocaleString("es-CO")}`;
}
