import { quoteInputSchema } from "@savia/studio-shared/savia-request-quotes";
import { insuranceQuoteProductCatalog } from "./configuration";
import { insuranceQuotesExtensionId } from "./ids";
import {
  publicQuoteFields,
  publicValuesToQuoteInput,
  validatePublicQuoteValues,
} from "./public-form";
import type { AutoLightQuoteInput } from "./screens/quote-input";

type FlowComponent = Record<string, unknown>;
type FlowScreen = {
  id: string;
  title: string;
  terminal?: boolean;
  data?: Record<string, { type: "string"; __example__: string }>;
  layout: {
    type: "SingleColumnLayout";
    children: Array<{
      type: "Form";
      name: string;
      children: FlowComponent[];
    }>;
  };
};

const fieldByName = new Map(
  publicQuoteFields.map((field) => [field.name, field]),
);

function fieldComponent(name: string): FlowComponent {
  const field = fieldByName.get(name);
  if (!field) throw new Error(`Unknown insurance quote field: ${name}`);
  const flowLabel: Record<string, string> = {
    vehicle_circulationCity: "Ciudad circulación",
    applicant_city: "Ciudad residencia",
  };
  const label = flowLabel[name] ?? field.label;
  if (field.type === "select") {
    return {
      type: "Dropdown",
      name: field.name,
      label,
      required: field.required,
      "data-source": field.options!.map(({ value, label }) => ({
        id: value,
        title: label,
      })),
    };
  }
  if (field.type === "date") {
    return {
      type: "DatePicker",
      name: field.name,
      label,
      required: field.required,
    };
  }
  if (field.type === "boolean") {
    return {
      type: "Dropdown",
      name: field.name,
      label: "Vehículo nuevo",
      required: true,
      "data-source": [
        { id: "true", title: "Sí" },
        { id: "false", title: "No" },
      ],
    };
  }
  const inputType =
    field.type === "email"
      ? "email"
      : name === "applicant_phone"
        ? "phone"
        : field.type === "number"
          ? "number"
          : "text";
  return {
    type: "TextInput",
    name: field.name,
    label,
    required: field.required,
    "input-type": inputType,
  };
}

function navigateFooter(
  label: string,
  screen: string,
  payload: Record<string, string>,
): FlowComponent {
  return {
    type: "Footer",
    label,
    "on-click-action": {
      name: "navigate",
      next: { type: "screen", name: screen },
      payload,
    },
  };
}

const vehicleFields = [
  "vehicle_plate",
  "vehicle_fasecoldaCode",
  "vehicle_productionYear",
  "vehicle_isNew",
  "vehicle_circulationCity",
  "vehicle_accessoriesValue",
  "vehicle_declaredValue",
] as const;
const applicantFields = [
  "applicant_documentType",
  "applicant_documentNumber",
  "applicant_firstName",
  "applicant_surname",
  "applicant_secondSurname",
  "applicant_gender",
  "applicant_birthDate",
] as const;
const contactFields = [
  "applicant_city",
  "applicant_address",
  "applicant_phone",
  "applicant_email",
] as const;

const fieldExamples: Record<string, string> = {
  vehicle_plate: "ABC123",
  vehicle_fasecoldaCode: "04408010",
  vehicle_productionYear: "2023",
  vehicle_isNew: "false",
  vehicle_circulationCity: "11001",
  vehicle_accessoriesValue: "0",
  vehicle_declaredValue: "65000000",
  applicant_documentType: "CC",
  applicant_documentNumber: "12345678",
  applicant_firstName: "Ana",
  applicant_surname: "Pérez",
  applicant_secondSurname: "Gómez",
  applicant_gender: "F",
  applicant_birthDate: "1990-01-01",
};

function dataSchema(fields: readonly string[]) {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      { type: "string" as const, __example__: fieldExamples[field] },
    ]),
  );
}

const screen = (
  id: string,
  title: string,
  fields: readonly string[],
  footer: FlowComponent | undefined,
  terminal = false,
  data: FlowScreen["data"] = {},
): FlowScreen => ({
  id,
  title,
  ...(terminal ? { terminal: true } : {}),
  data,
  layout: {
    type: "SingleColumnLayout",
    children: [
      {
        type: "Form",
        name: `${id.toLowerCase()}_form`,
        children: [
          ...fields.map(fieldComponent),
          ...(terminal
            ? [
                {
                  type: "OptIn",
                  name: "consent_quote_processing",
                  label:
                    "Autorizo el tratamiento de mis datos para gestionar esta solicitud de cotización.",
                  required: true,
                },
                {
                  type: "Footer",
                  label: "Enviar solicitud",
                  "on-click-action": {
                    name: "complete",
                    payload: {
                      ...Object.fromEntries(
                        vehicleFields.map((name) => [name, `\${data.${name}}`]),
                      ),
                      ...Object.fromEntries(
                        applicantFields.map((name) => [
                          name,
                          `\${data.${name}}`,
                        ]),
                      ),
                      ...Object.fromEntries(
                        contactFields.map((name) => [name, `\${form.${name}}`]),
                      ),
                      consent_quote_processing:
                        "${form.consent_quote_processing}",
                    },
                  },
                },
              ]
            : [footer!]),
        ],
      },
    ],
  },
});

/** Static Meta WhatsApp Flow: it collects consented intake and never calls insurers. */
export const insuranceVehicleQuoteWhatsappFlow = {
  version: "7.3",
  screens: [
    screen(
      "VEHICLE",
      "Datos del vehículo",
      vehicleFields,
      navigateFooter(
        "Continuar",
        "APPLICANT",
        Object.fromEntries(
          vehicleFields.map((field) => [field, "${form." + field + "}"]),
        ),
      ),
    ),
    screen(
      "APPLICANT",
      "Solicitante y conductor",
      applicantFields,
      navigateFooter(
        "Continuar",
        "CONTACT_CONSENT",
        Object.fromEntries([
          ...vehicleFields.map((field) => [field, "${data." + field + "}"]),
          ...applicantFields.map((field) => [field, "${form." + field + "}"]),
        ]),
      ),
      false,
      dataSchema(vehicleFields),
    ),
    screen(
      "CONTACT_CONSENT",
      "Contacto y autorización",
      contactFields,
      undefined,
      true,
      dataSchema([...vehicleFields, ...applicantFields]),
    ),
  ],
} as const;

/**
 * Contribution surfaced through the core release catalog. Tenant settings
 * select quote products; this contribution only defines intake and validation.
 */
export const insuranceWhatsappContribution = {
  pluginId: insuranceQuotesExtensionId,
  solutionId: "savia.insurance-quoter",
  bundleId: "insurance-auto-light",
  title: "Cotización de autos livianos",
  providerExecutionEnabled: false,
  products: insuranceQuoteProductCatalog,
  flowJson: insuranceVehicleQuoteWhatsappFlow,
  validate: validateWhatsappVehicleQuoteIntake,
} as const;

/** Validate untrusted Flow completion data and return the plugin's quote shape. */
export function validateWhatsappVehicleQuoteIntake(
  value: unknown,
): AutoLightQuoteInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Revisa los datos de la solicitud.");
  const input = value as Record<string, unknown>;
  if (input.consent_quote_processing !== true)
    throw new Error("Se requiere autorización para tratar los datos.");

  const allowed = new Set([
    ...publicQuoteFields.map((field) => field.name),
    "consent_quote_processing",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new Error("La solicitud contiene campos no permitidos.");

  const values = Object.fromEntries(
    publicQuoteFields.map((field) => {
      const value = input[field.name];
      if (field.name !== "vehicle_isNew") return [field.name, value];
      if (value === "true") return [field.name, true];
      if (value === "false") return [field.name, false];
      return [field.name, value];
    }),
  );
  const validated = validatePublicQuoteValues(values);
  if (!/^[A-Z0-9]{3,10}$/.test(String(validated.vehicle_plate)))
    throw new Error("Revisa la placa del vehículo.");
  const quoteInput = quoteInputSchema.parse(
    publicValuesToQuoteInput(validated),
  );
  return {
    vehicle: quoteInput.vehicle,
    applicant: quoteInput.applicant,
  };
}
