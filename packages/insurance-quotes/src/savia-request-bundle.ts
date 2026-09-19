export type InsuranceSaviaRequestFlow = {
  id: string;
  label: string;
  role: "internal" | "lookup" | "quote";
  enabledByDefault?: boolean;
};

export const insuranceSaviaRequestBundle = {
  id: "insurance-auto-light",
  version: "1.1.0",
  flows: [
    {
      id: "sbs-producto-8",
      label: "SBS · Autos Producto 8",
      role: "quote",
    },
    { id: "sbs-producto-10", label: "SBS · Gold", role: "quote" },
    { id: "sbs-producto-11", label: "SBS · Plata", role: "quote" },
    {
      id: "equidad-basico-quote",
      label: "Equidad · Básico",
      role: "quote",
    },
    {
      id: "equidad-full-quote",
      label: "Equidad · Full",
      role: "quote",
    },
    {
      id: "equidad-ligero-quote",
      label: "Equidad · Ligero",
      role: "quote",
    },
    {
      id: "equidad-rce-quote",
      label: "Equidad · RCE",
      role: "quote",
    },
    {
      id: "liberty-basico-quote",
      label: "Liberty · Básico",
      role: "quote",
    },
    {
      id: "liberty-basico-pt-quote",
      label: "Liberty · Básico + PT",
      role: "quote",
    },
    { id: "liberty-full-quote", label: "Liberty · Full", role: "quote" },
    {
      id: "liberty-integral-quote",
      label: "Liberty · Integral",
      role: "quote",
    },
    {
      id: "mapfre-para-la-mujer-quote",
      label: "Mapfre · Para la Mujer",
      role: "quote",
    },
    {
      id: "qualitas-direct-research",
      label: "Qualitas · Amplia",
      role: "quote",
    },
    { id: "qualitas-base-quote", label: "Qualitas · Base", role: "quote" },
    { id: "qualitas-plus-quote", label: "Qualitas · Plus", role: "quote" },
    {
      id: "previsora-clasica-quote",
      label: "Previsora · Clásica",
      role: "quote",
    },
    {
      id: "previsora-preferente-quote",
      label: "Previsora · Preferente",
      role: "quote",
    },
    {
      id: "previsora-premium-quote",
      label: "Previsora · Premium",
      role: "quote",
    },
    {
      id: "previsora-sin-asistencia-quote",
      label: "Previsora · Sin asistencia",
      role: "quote",
    },
    {
      id: "sura-autos-provider",
      label: "Sura",
      role: "lookup",
      enabledByDefault: true,
    },
    {
      id: "equidad-vehicle-by-plate",
      label: "Equidad",
      role: "lookup",
      enabledByDefault: false,
    },
    {
      id: "liberty-get-oauth-token",
      label: "Liberty OAuth",
      role: "internal",
    },
  ],
} as const satisfies {
  id: string;
  version: string;
  flows: readonly InsuranceSaviaRequestFlow[];
};

export const insuranceQuoteFlowCatalog =
  insuranceSaviaRequestBundle.flows.filter((flow) => flow.role === "quote");

export const insuranceLookupFlowCatalog =
  insuranceSaviaRequestBundle.flows.filter((flow) => flow.role === "lookup");

export function isInsuranceSaviaRequestFlow(flowId: string): boolean {
  return insuranceSaviaRequestBundle.flows.some((flow) => flow.id === flowId);
}

export { toSaviaRequestInput } from "./savia-request-input";
