import { insuranceQuotesExtensionId } from "./connectors";
import {
  InsurancePackageAdminScreen,
  InsuranceQuoteWizardScreen,
  InsuranceQuoteWorkspaceScreen,
} from "./screens/quote-screens";

export type InsuranceQuoteResult = {
  type: "quote";
  provider: string;
  status: "success";
  data: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isInsuranceQuoteResult(
  extensionId: string,
  value: unknown,
): value is InsuranceQuoteResult {
  return (
    extensionId === insuranceQuotesExtensionId &&
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "quote"
  );
}

export function InsuranceQuoteResultRenderer({ result }: { result: unknown }) {
  const quote = isInsuranceQuoteResult(insuranceQuotesExtensionId, result)
    ? result
    : null;
  if (!quote) return null;
  const data = record(quote.data);
  const quoteNumber =
    typeof data?.quoteNumber === "string" ? data.quoteNumber : null;
  const premium =
    typeof data?.premiumTotal === "number" ||
    typeof data?.premiumTotal === "string"
      ? String(data.premiumTotal)
      : null;

  return (
    <article
      aria-label="Resultado de cotización"
      className="space-y-2 rounded-lg border bg-card p-4"
    >
      <p className="text-sm font-medium">Cotización de {quote.provider}</p>
      {premium ? (
        <strong className="block text-2xl font-semibold">{premium}</strong>
      ) : null}
      {quoteNumber ? (
        <p className="text-sm text-muted-foreground">
          Referencia: {quoteNumber}
        </p>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">
          Ver respuesta del proveedor
        </summary>
        <pre className="mt-2 max-h-56 overflow-auto rounded bg-muted/40 p-3 text-xs">
          {JSON.stringify(quote.data, null, 2)}
        </pre>
      </details>
    </article>
  );
}

export const insuranceQuoteResultRenderers = [
  {
    extensionId: insuranceQuotesExtensionId,
    Renderer: InsuranceQuoteResultRenderer,
  },
] as const;

export const insuranceQuoteScreens = [
  {
    id: "insurance.quotes.direct",
    extensionId: insuranceQuotesExtensionId,
    object: "cotizador",
    view: "records",
    Screen: InsuranceQuoteWorkspaceScreen,
  },
  {
    id: "insurance.quotes.wizard",
    extensionId: insuranceQuotesExtensionId,
    object: "cotizador_por_pasos",
    view: "records",
    Screen: InsuranceQuoteWizardScreen,
  },
  {
    id: "insurance.quotes.admin",
    extensionId: insuranceQuotesExtensionId,
    object: "administrar_seguros",
    view: "records",
    Screen: InsurancePackageAdminScreen,
  },
] as const;
