import { z } from "zod";
const resultSchema = z.object({
  quoteId: z.string(),
  reference: z.string(),
  // Fase 1: acepta canónica #/studio y alias legacy #/crm.
  url: z
    .string()
    .refine(
      (value) => value.startsWith("/#/studio?") || value.startsWith("/#/crm?"),
      { message: "Invalid url" },
    ),
  failedOffers: z.number(),
  unpricedOffers: z.number(),
  pricedOffers: z.number(),
  lowestPremium: z.number().nullable(),
  lowestPriceOffers: z.array(
    z.object({
      provider: z.string(),
      product: z.string(),
      premium: z.number(),
    }),
  ),
  tiedOfferCount: z.number(),
  recommendation: z.string(),
  persistenceWarnings: z.array(z.string()),
});
export function parseQuoteResult(raw: unknown) {
  let value: any = raw;
  if (value?.structuredContent) value = value.structuredContent;
  else if (Array.isArray(value?.content)) {
    const text = value.content.find((part: any) => part.type === "text")?.text;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
  }
  const parsed = resultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function AssistantQuoteResult({
  result,
}: {
  result: NonNullable<ReturnType<typeof parseQuoteResult>>;
}) {
  return (
    <div className="mt-3 space-y-2" aria-label="Resultado de cotización">
      <p className="font-semibold">Cotización {result.reference}</p>
      <p>
        {result.pricedOffers} ofertas con precio · {result.failedOffers}{" "}
        fallidas · {result.unpricedOffers} sin prima.
      </p>
      {result.lowestPremium !== null && (
        <p>
          Menor prima recibida:{" "}
          <strong>
            {new Intl.NumberFormat("es-CO", {
              style: "currency",
              currency: "COP",
              maximumFractionDigits: 0,
            }).format(result.lowestPremium)}
          </strong>
          {result.tiedOfferCount > 1
            ? ` (${result.tiedOfferCount} ofertas empatadas)`
            : ""}
          .
        </p>
      )}
      {result.lowestPriceOffers.length > 0 && (
        <p>
          {result.lowestPriceOffers.map((offer) => offer.product).join(" · ")}
        </p>
      )}
      <p>{result.recommendation}</p>
      {result.persistenceWarnings.map((warning) => (
        <p key={warning} role="alert">
          {warning}
        </p>
      ))}
      <a
        className="font-medium text-primary underline"
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Ver cotización y comparar ofertas
      </a>
    </div>
  );
}

export const quoteFieldLabels: Record<string, string> = {
  "vehicle.plate": "Placa",
  "vehicle.fasecoldaCode": "Código Fasecolda",
  "vehicle.productionYear": "Año",
  "vehicle.isNew": "Vehículo nuevo",
  "vehicle.circulationCity": "Ciudad de circulación (DANE)",
  "vehicle.accessoriesValue": "Accesorios (COP)",
  "vehicle.declaredValue": "Valor asegurado (COP)",
  "applicant.documentType": "Tipo de documento",
  "applicant.documentNumber": "Documento",
  "applicant.firstName": "Nombres",
  "applicant.surname": "Primer apellido",
  "applicant.secondSurname": "Segundo apellido",
  "applicant.gender": "Sexo",
  "applicant.birthDate": "Fecha de nacimiento",
  "applicant.city": "Ciudad de residencia (DANE)",
  "applicant.address": "Dirección",
  "applicant.phone": "Teléfono",
  "applicant.email": "Correo",
};

export function formatQuoteField(value: unknown, key: string): string {
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (key === "applicant.gender")
    return value === "M"
      ? "Masculino"
      : value === "F"
        ? "Femenino"
        : String(value);
  if (
    ["vehicle.accessoriesValue", "vehicle.declaredValue"].includes(key) &&
    typeof value === "number" &&
    Number.isFinite(value)
  )
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(value);
  if (
    key === "applicant.birthDate" &&
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  )
    return value.split("-").reverse().join("/");
  return String(value ?? "");
}
