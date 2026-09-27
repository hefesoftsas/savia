export type QuoteBatchItem = {
  productId: string;
  flowId: string;
  label: string;
  provider: string;
  status: "pending" | "succeeded" | "failed";
  error?: string;
  errorCode?: string | null;
  runId?: string;
  detailId?: string;
  detailVersion?: number;
  quoteNumber?: string;
  premium?: number;
  /** Tiempo de ejecución del producto en ms (visibilidad de performance). */
  durationMs?: number;
  /** Snapshot normalizado persistido para renderizar el historial sin runs. */
  snapshot?: import("../quote-snapshot").QuoteResultSnapshot;
};
