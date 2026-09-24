import { z } from "zod";

/**
 * Lógica pura de cotización savia-request, independiente del release.
 * El host la usa para ejecutar acciones `savia-request` del store y el
 * paquete de seguros la reexporta para compatibilidad.
 */

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

export function providerForFlow(flowId: string): string {
  const label = insuranceSaviaRequestBundle.flows.find(
    (flow) => flow.id === flowId,
  )?.label;
  return label?.split(" · ")[0] ?? "Seguros";
}

export type AutoLightQuoteInput = {
  vehicle: {
    plate: string;
    fasecoldaCode: string;
    productionYear: number;
    isNew: boolean;
    circulationCity: string;
    accessoriesValue: number;
    declaredValue: number;
  };
  applicant: {
    documentType: string;
    documentNumber: string;
    firstName: string;
    surname: string;
    secondSurname?: string;
    gender: string;
    birthDate: string;
    city: string;
    address: string;
    phone: string;
    email: string;
  };
};

const canonicalQuoteInputFlowIds = new Set([
  "sbs-producto-8",
  "sbs-producto-10",
  "sbs-producto-11",
]);

function normalizedPlate(input: AutoLightQuoteInput): string {
  return input.vehicle.plate.trim().toUpperCase();
}

function sbsInput(input: AutoLightQuoteInput): Record<string, string> {
  return {
    "auto_light.applicant.address": input.applicant.address,
    "auto_light.applicant.birthDate": input.applicant.birthDate,
    "auto_light.applicant.city": input.applicant.city,
    "auto_light.applicant.documentNumber": input.applicant.documentNumber,
    "auto_light.applicant.documentType": input.applicant.documentType,
    "auto_light.applicant.email": input.applicant.email,
    "auto_light.applicant.firstName": input.applicant.firstName,
    "auto_light.applicant.gender": input.applicant.gender,
    "auto_light.applicant.phone": input.applicant.phone,
    "auto_light.applicant.secondSurname": input.applicant.secondSurname ?? "",
    "auto_light.applicant.surname": input.applicant.surname,
    "auto_light.vehicle.accessoriesValue": String(
      input.vehicle.accessoriesValue,
    ),
    "auto_light.vehicle.circulationCity": input.vehicle.circulationCity,
    "auto_light.vehicle.declaredValue": String(input.vehicle.declaredValue),
    "auto_light.vehicle.fasecoldaCode": input.vehicle.fasecoldaCode,
    "auto_light.vehicle.isNew": String(input.vehicle.isNew),
    "auto_light.vehicle.plate": normalizedPlate(input),
    "auto_light.vehicle.productionYear": String(input.vehicle.productionYear),
  };
}

export function toSaviaRequestInput(
  flowId: string,
  input: AutoLightQuoteInput,
): Record<string, string> {
  if (!isInsuranceSaviaRequestFlow(flowId))
    throw new Error("Flow de Seguros no permitido.");
  if (flowId === "sura-autos-provider")
    return { sura_test_plate: normalizedPlate(input) };
  if (flowId === "equidad-vehicle-by-plate")
    return { equidad_v2_test_plate: normalizedPlate(input) };
  if (canonicalQuoteInputFlowIds.has(flowId)) return sbsInput(input);
  const flow = insuranceSaviaRequestBundle.flows.find(
    (candidate) => candidate.id === flowId,
  );
  if (flow?.role === "quote") return {};
  throw new Error(
    "El flow de Seguros no se puede ejecutar desde el cotizador.",
  );
}

const sensitiveField = /(?:api[_-]?key|authorization|password|secret|token)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveField.test(key))
      .map(([key, nested]) => [key, redact(nested)]),
  );
}

export type NormalizedInsurerQuote = {
  type: "quote";
  provider: string;
  status: "success";
  data: unknown;
};

export type NormalizedVehicleLookup = {
  type: "vehicle_lookup";
  provider: string;
  status: "success" | "partial";
  data: {
    vehicle: {
      plate: string;
      productionYear?: number;
      fasecoldaCode?: string;
      engineNumber?: string;
      chassisNumber?: string;
      declaredValue?: number;
      accessoriesValue?: number;
      currency: "COP";
    } | null;
  };
};

export type NormalizedInsuranceAction =
  NormalizedInsurerQuote | NormalizedVehicleLookup;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numeric(value: unknown): number | undefined {
  const candidate =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(candidate) ? candidate : undefined;
}

function vehicleFromLookup(
  value: unknown,
): NormalizedVehicleLookup["data"]["vehicle"] {
  const wrapped = record(value);
  const source = record(wrapped?.response) ?? wrapped;
  const plate = text(source?.placa ?? source?.plate);
  if (!plate) return null;
  const productionYear = numeric(source?.modelo ?? source?.modelYear);
  const year =
    productionYear && productionYear >= 1900 && productionYear <= 2200
      ? productionYear
      : undefined;
  return {
    plate: plate.toUpperCase(),
    ...(year === undefined ? {} : { productionYear: year }),
    ...(text(source?.fasecolda) === undefined
      ? {}
      : { fasecoldaCode: text(source?.fasecolda) }),
    ...(text(source?.motor) === undefined
      ? {}
      : { engineNumber: text(source?.motor) }),
    ...(text(source?.chasis) === undefined
      ? {}
      : { chassisNumber: text(source?.chasis) }),
    ...(numeric(source?.valorAsegurado) === undefined
      ? {}
      : { declaredValue: numeric(source?.valorAsegurado) }),
    ...(numeric(source?.valorAccesorios) === undefined
      ? {}
      : { accessoriesValue: numeric(source?.valorAccesorios) }),
    currency: "COP",
  };
}

export function normalizeInsurerQuote(
  provider: string,
  response: unknown,
): NormalizedInsurerQuote {
  return {
    type: "quote",
    provider,
    status: "success",
    data: redact(response),
  };
}

export function normalizeInsuranceAction(
  provider: string,
  operationId: string,
  response: unknown,
): NormalizedInsuranceAction {
  if (
    operationId === "sura-vehicle-by-plate" ||
    operationId === "sura-autos-provider"
  ) {
    const vehicle = vehicleFromLookup(response);
    return {
      type: "vehicle_lookup",
      provider,
      status: vehicle ? "success" : "partial",
      data: { vehicle },
    };
  }
  return normalizeInsurerQuote(provider, response);
}

const quoteVehicleSchema = z
  .object({
    plate: z.string().trim().min(1),
    fasecoldaCode: z.string().trim().min(1),
    productionYear: z.number().int(),
    isNew: z.boolean(),
    circulationCity: z.string().trim().min(1),
    accessoriesValue: z.number().finite().min(0),
    declaredValue: z.number().finite().positive(),
  })
  .strict();

const quoteApplicantSchema = z
  .object({
    documentType: z.string().trim().min(1),
    documentNumber: z.string().trim().min(1),
    firstName: z.string().trim().min(1),
    surname: z.string().trim().min(1),
    secondSurname: z.string().trim().min(1).optional(),
    gender: z.string().trim().min(1),
    birthDate: z.string().trim().min(1),
    city: z.string().trim().min(1),
    address: z.string().trim().min(1),
    phone: z.string().trim().min(1),
    email: z.string().trim().min(1),
  })
  .strict();

export const quoteInputSchema = z
  .object({ vehicle: quoteVehicleSchema, applicant: quoteApplicantSchema })
  .strict();

export const lookupQuoteInputSchema = z
  .object({
    vehicle: z.object({ plate: z.string().trim().min(1) }).passthrough(),
  })
  .passthrough();

export const saviaRequestActionInputSchema = z
  .object({
    mode: z.enum(["mock", "live"]),
    flowId: z.string().trim().min(1),
    quoteInput: z.unknown(),
  })
  .strict();

export const saviaRequestFlowRunSchema = z
  .object({ status: z.string(), result: z.unknown().nullable() })
  .passthrough();

export type SaviaRequestService = {
  fetch(request: Request): Response | Promise<Response>;
};
