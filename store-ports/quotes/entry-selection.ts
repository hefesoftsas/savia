export type QuoteTab = "direct" | "wizard" | "admin";

export function quoteTabForScreen(object: string | undefined): QuoteTab {
  if (!object || object === "cotizador_por_pasos") return "wizard";
  if (object === "administrar_seguros") return "admin";
  return "direct";
}
