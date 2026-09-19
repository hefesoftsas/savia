import {
  insuranceQuoteSettingsDefinition,
  insurancePackageSettingsSchema,
} from "./configuration";
import { insuranceQuoteFlowCatalog } from "./savia-request-bundle";
import {
  defaultQuoteFormValues,
  validateQuote,
  toAutoLightQuoteInput,
  type QuoteFormValues,
} from "./screens/quote-input";
export {
  insuranceQuoteSettingsDefinition,
  insurancePackageSettingsSchema,
} from "./configuration";
export { insuranceQuoteFlowCatalog } from "./savia-request-bundle";

export type PublicQuoteField = {
  name: string;
  label: string;
  type: "text" | "number" | "email" | "date" | "boolean" | "select";
  required: boolean;
  options?: { value: string; label: string }[];
};
export const publicQuoteFields: PublicQuoteField[] = [
  { name: "vehicle_plate", label: "Placa", type: "text", required: true },
  {
    name: "vehicle_fasecoldaCode",
    label: "Código Fasecolda",
    type: "text",
    required: true,
  },
  {
    name: "vehicle_productionYear",
    label: "Año del vehículo",
    type: "number",
    required: true,
  },
  {
    name: "vehicle_isNew",
    label: "Vehículo nuevo",
    type: "boolean",
    required: false,
  },
  {
    name: "vehicle_circulationCity",
    label: "Código de ciudad de circulación",
    type: "text",
    required: true,
  },
  {
    name: "vehicle_accessoriesValue",
    label: "Valor de accesorios",
    type: "number",
    required: false,
  },
  {
    name: "vehicle_declaredValue",
    label: "Valor asegurado",
    type: "number",
    required: true,
  },
  {
    name: "applicant_documentType",
    label: "Tipo de documento",
    type: "select",
    required: true,
    options: [
      { value: "CC", label: "Cédula de ciudadanía" },
      { value: "CE", label: "Cédula de extranjería" },
    ],
  },
  {
    name: "applicant_documentNumber",
    label: "Número de documento",
    type: "text",
    required: true,
  },
  {
    name: "applicant_firstName",
    label: "Nombres",
    type: "text",
    required: true,
  },
  {
    name: "applicant_surname",
    label: "Primer apellido",
    type: "text",
    required: true,
  },
  {
    name: "applicant_secondSurname",
    label: "Segundo apellido",
    type: "text",
    required: false,
  },
  {
    name: "applicant_gender",
    label: "Sexo",
    type: "select",
    required: true,
    options: [
      { value: "F", label: "Femenino" },
      { value: "M", label: "Masculino" },
    ],
  },
  {
    name: "applicant_birthDate",
    label: "Fecha de nacimiento",
    type: "date",
    required: true,
  },
  {
    name: "applicant_city",
    label: "Código de ciudad de residencia",
    type: "text",
    required: true,
  },
  {
    name: "applicant_address",
    label: "Dirección",
    type: "text",
    required: true,
  },
  { name: "applicant_phone", label: "Teléfono", type: "text", required: true },
  {
    name: "applicant_email",
    label: "Correo electrónico",
    type: "email",
    required: true,
  },
];
export function validatePublicQuoteValues(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(publicQuoteFields.map((f) => f.name));
  if (Object.keys(values).some((key) => !allowed.has(key)))
    throw new Error("El formulario contiene campos no permitidos.");
  const flat: Record<string, unknown> = {};
  const form: QuoteFormValues = structuredClone(defaultQuoteFormValues);
  for (const field of publicQuoteFields) {
    let value = values[field.name];
    if (value === undefined || value === "") {
      if (field.required) throw new Error(`Completa ${field.label}.`);
      value =
        field.type === "boolean" ? false : field.type === "number" ? 0 : "";
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean") throw new Error(`Revisa ${field.label}.`);
    } else if (field.type === "number") {
      if (
        !["string", "number"].includes(typeof value) ||
        String(value).trim() === "" ||
        !Number.isFinite(Number(value)) ||
        Math.abs(Number(value)) > 1e12
      )
        throw new Error(`Revisa ${field.label}.`);
      value = Number(value);
    } else {
      if (typeof value !== "string" || value.length > 200)
        throw new Error(`Revisa ${field.label}.`);
      value = value.trim();
      if (
        field.options &&
        !field.options.some((option) => option.value === value)
      )
        throw new Error(`Revisa ${field.label}.`);
      if (field.type === "date") {
        const date = new Date(String(value));
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ||
          !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== value ||
          date.getTime() > Date.now()
        )
          throw new Error(`Revisa ${field.label}.`);
      }
    }
    if (field.name === "vehicle_plate") value = String(value).toUpperCase();
    flat[field.name] = value;
    const split = field.name.indexOf("_"),
      section = field.name.slice(0, split) as "vehicle" | "applicant",
      key = field.name.slice(split + 1);
    (form[section] as unknown as Record<string, unknown>)[key] =
      field.type === "boolean" ? value : String(value);
  }
  const errors = validateQuote(form);
  if (Object.keys(errors).length)
    throw new Error(Object.values(errors).join(" "));
  return flat;
}
export function publicValuesToQuoteInput(values: Record<string, unknown>) {
  const flat = validatePublicQuoteValues(values),
    form: QuoteFormValues = structuredClone(defaultQuoteFormValues);
  for (const field of publicQuoteFields) {
    const split = field.name.indexOf("_"),
      section = field.name.slice(0, split) as "vehicle" | "applicant",
      key = field.name.slice(split + 1);
    (form[section] as unknown as Record<string, unknown>)[key] =
      field.type === "boolean" ? flat[field.name] : String(flat[field.name]);
  }
  return toAutoLightQuoteInput(form);
}

const catalog = new Map<string, (typeof insuranceQuoteFlowCatalog)[number]>(
  insuranceQuoteFlowCatalog.map((product) => [product.id, product]),
);
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function projectPublicQuoteResult(flowId: string, output: unknown) {
  const product = catalog.get(flowId)!;
  const data = record(record(output)?.data);
  const economics = record(record(data?.response)?.datosEconomicos);
  const value =
    data?.premiumTotal ??
    data?.premium ??
    economics?.total ??
    economics?.primaAnual;
  const premium =
    typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")
      ? Number(value)
      : NaN;
  // No raw strings from provider payloads are exposed, including quote references
  // (which can embed a plate or document number). Coverage labels are fixed here.
  const coverageLabels: Record<string, string> = {
    rce: "Responsabilidad civil",
    partialLoss: "Pérdida parcial",
    totalLoss: "Pérdida total",
    replacementCar: "Vehículo de reemplazo",
    roadsideAssistance: "Asistencia en carretera",
    medicalExpenses: "Gastos médicos",
    legalAssistance: "Asistencia jurídica",
  };
  const source = record(data?.coverages);
  const coverages = Object.entries(coverageLabels)
    .filter(([key]) => source?.[key] === true)
    .map(([, label]) => label);
  return {
    insurer: product.label.split(" · ")[0],
    product: product.label,
    premiumTotal:
      Number.isFinite(premium) && premium > 0 && premium <= 1e12
        ? premium
        : null,
    currency: "COP",
    coverages,
  };
}

/** Trusted industry contribution consumed by the generic public form host. */
export const insurancePublicQuoteContribution = {
  extensionId: "insurance.quotes",
  actionId: "quote",
  mode: "live",
  connectionId: "simulation",
  objectNames: ["cotizador", "cotizador_por_pasos"] as readonly string[],
  settingsDefinition: insuranceQuoteSettingsDefinition,
  fields: publicQuoteFields,
  products: insuranceQuoteFlowCatalog,
  readSettings(value: unknown, objectName: string) {
    const settings = insurancePackageSettingsSchema.parse(value);
    return {
      enabled:
        objectName === "cotizador"
          ? settings.quotePages.direct
          : settings.quotePages.wizard,
      products: settings.products,
    };
  },
  validateValues: validatePublicQuoteValues,
  actionInput(
    flowId: string,
    values: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!catalog.has(flowId)) throw new Error("Unsupported quote product");
    return {
      mode: "live",
      flowId,
      quoteInput: publicValuesToQuoteInput(values),
    };
  },
  projectResult: projectPublicQuoteResult,
} as const;
