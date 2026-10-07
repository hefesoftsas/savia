import type { InsuranceQuoteProgress } from "@savia/release-catalog/assistant-operations";

export function quoteProgressText(progress: InsuranceQuoteProgress): string {
  const status =
    progress.state === "priced"
      ? `Prima: $${Number(progress.premium).toLocaleString("es-CO")}`
      : progress.state === "unpriced"
        ? "Respuesta recibida sin precio."
        : progress.state === "uncertain"
          ? "Solicitud sin resultado verificado."
          : "No se pudo completar esta opción.";
  return [
    `Avance de ${progress.reference}`,
    progress.product,
    status,
    progress.quoteNumber ? `Número de cotización: ${progress.quoteNumber}` : "",
    "El resumen final llegará al terminar las consultas.",
  ]
    .filter(Boolean)
    .join("\n");
}
