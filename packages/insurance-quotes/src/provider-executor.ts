import {
  ExternalProviderUpstreamError,
  ProviderConfigurationInvalidError,
} from "./errors";
import { requireProviderOperation } from "./provider-definitions";
import type { ProviderOperationMetadata } from "./provider-metadata.generated";
import { prepareProviderRequest } from "./provider-request-preparation";
import { redactProviderData } from "./redaction";
import {
  executeSbsProductFlow,
  sbsProductFlows,
  type SbsProductStartOperationId,
} from "./sbs-product-flow";
import { isPublicProviderOperation } from "@savia/provider-contracts";

type CanonicalInput = Record<string, unknown>;

const fieldAliases: Record<string, string[]> = {
  "vehicle.plate": [
    "plate",
    "placa",
    "placaVeh",
    "placaVehiculo",
    "licensePlate",
    "vehiclePlate",
  ],
  "vehicle.fasecoldaCode": [
    "fasecolda",
    "fasecoldaCode",
    "codigoFasecolda",
    "codFasecolda",
  ],
  "vehicle.reference": ["reference", "referencia", "ref"],
  "vehicle.productionYear": [
    "year",
    "modelYear",
    "productionYear",
    "ano",
    "anio",
  ],
  "vehicle.declaredValue": [
    "declaredValue",
    "vehicleValue",
    "valorAsegurado",
    "valorVehiculo",
  ],
  "vehicle.circulationCity": [
    "circulationCity",
    "cityOfCirculation",
    "ciudadCirculacion",
  ],
  "vehicle.isNew": ["isNew", "newVehicle", "vehiculoNuevo"],
  "vehicle.use": ["vehicleUse", "usoVehiculo"],
  "vehicle.accessoriesValue": ["accessoriesValue", "valorAccesorios"],
  "vehicle.shieldingValue": ["shieldingValue", "valorBlindaje"],
  "applicant.documentType": ["documentType", "tipoDocumento"],
  "applicant.documentNumber": [
    "documentNumber",
    "numeroDocumento",
    "identification",
  ],
  "applicant.firstName": ["firstName", "primerNombre", "nombres"],
  "applicant.secondName": ["secondName", "segundoNombre"],
  "applicant.surname": ["surname", "lastName", "primerApellido", "apellidos"],
  "applicant.secondSurname": ["secondSurname", "segundoApellido"],
  "applicant.birthDate": ["birthDate", "fechaNacimiento", "fecNacConductor"],
  "applicant.gender": ["gender", "sexo", "sexoConductor"],
  "applicant.occupation": ["occupation", "ocupacion"],
  "applicant.email": ["email", "mail", "mailTomador", "correo"],
  "applicant.phone": ["phone", "cellphone", "celTomador", "telefono"],
  "applicant.address": ["address", "dirTomador", "direccion"],
  "applicant.city": ["city", "ciuTomador", "ciudad"],
  "applicant.department": ["department", "departamento"],
  "preferences.paymentPlan": ["paymentPlan", "planPago"],
  "preferences.planType": ["planType", "tipoPlan"],
  "preferences.coverages": ["coverages", "coberturas"],
};

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function valueAtPath(input: CanonicalInput, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, input);
}

function canonicalValueForKey(key: string, input: CanonicalInput): unknown {
  const keyName = normalizedKey(key);
  for (const [path, aliases] of Object.entries(fieldAliases)) {
    if (aliases.some((alias) => normalizedKey(alias) === keyName)) {
      const value = valueAtPath(input, path);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function hydrateJsonValue(value: unknown, input: CanonicalInput): unknown {
  if (Array.isArray(value))
    return value.map((item) => hydrateJsonValue(item, input));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      const canonical = canonicalValueForKey(key, input);
      return [
        key,
        canonical === undefined ? hydrateJsonValue(nested, input) : canonical,
      ];
    }),
  );
}

function xmlEscape(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function hydrateXmlTemplate(template: string, input: CanonicalInput): string {
  let hydrated = template.replace(
    /\{\{\s*auto_light\.([a-zA-Z0-9_.]+)\s*\}\}/g,
    (_match, path: string) => {
      const value = valueAtPath(input, path);
      return value === undefined || typeof value === "object"
        ? ""
        : xmlEscape(value);
    },
  );
  for (const [path, aliases] of Object.entries(fieldAliases)) {
    const value = valueAtPath(input, path);
    if (value === undefined || typeof value === "object") continue;
    for (const alias of aliases) {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const element = new RegExp(
        `(<(?:[\\w.-]+:)?${escapedAlias}\\b[^>]*>)[\\s\\S]*?(<\\/(?:[\\w.-]+:)?${escapedAlias}>)`,
        "gi",
      );
      hydrated = hydrated.replace(
        element,
        (_match, open, close) => `${open}${xmlEscape(value)}${close}`,
      );
    }
  }
  return hydrated;
}

function hydrateCredentialTemplate(
  name: string,
  value: string,
  input: CanonicalInput,
): string {
  if (!/request_(?:body|xml)$/i.test(name)) return value;
  if (!input.vehicle || typeof input.vehicle !== "object") {
    throw new ProviderConfigurationInvalidError();
  }
  if (value.trimStart().startsWith("<"))
    return hydrateXmlTemplate(value, input);
  try {
    return JSON.stringify(hydrateJsonValue(JSON.parse(value), input));
  } catch {
    throw new ProviderConfigurationInvalidError();
  }
}

function inputValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  throw new ProviderConfigurationInvalidError();
}

function renderTemplate(
  template: string,
  values: Record<string, string>,
  transform = (value: string) => value,
): string {
  return template.replace(
    /\{\{\s*([^}]+?)\s*\}\}/g,
    (_match, variable: string) => {
      const value = values[variable];
      if (value === undefined) throw new ProviderConfigurationInvalidError();
      return transform(value);
    },
  );
}

function inputVariableValue(name: string, input: CanonicalInput): string {
  if (name.startsWith("auto_light.")) {
    return inputValue(valueAtPath(input, name.slice("auto_light.".length)));
  }
  if (!(name in input)) throw new ProviderConfigurationInvalidError();
  return inputValue(input[name]);
}

async function responseData(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  try {
    return redactProviderData(
      contentType.includes("json")
        ? await response.json()
        : await response.text(),
    );
  } catch {
    return null;
  }
}

export type ProviderExecutorOptions = {
  fetcher?: typeof fetch;
};

export class ProviderExecutor {
  private readonly fetcher: typeof fetch;

  constructor(options: ProviderExecutorOptions = {}) {
    this.fetcher = options.fetcher ?? ((request) => fetch(request));
  }

  async execute(
    providerId: string,
    operationId: string,
    input: CanonicalInput,
    credentials: Record<string, unknown>,
  ): Promise<{ status: number; data: unknown }> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ProviderConfigurationInvalidError();
    }
    if (!isPublicProviderOperation(operationId))
      throw new ProviderConfigurationInvalidError();
    const operation = requireProviderOperation(operationId);
    if (operation.providerId !== providerId)
      throw new ProviderConfigurationInvalidError();
    if (Object.values(credentials).some((value) => typeof value !== "string"))
      throw new ProviderConfigurationInvalidError();
    const configuredCredentials = credentials as Record<string, string>;
    if (operationId in sbsProductFlows)
      return this.executeSbsProduct(
        operationId as SbsProductStartOperationId,
        configuredCredentials,
        input,
      );
    return this.executeOperation(operation, configuredCredentials, input);
  }

  private valuesForOperation(
    operation: ProviderOperationMetadata,
    credentials: Record<string, string>,
    input: CanonicalInput,
    transientValues: Record<string, string> = {},
  ): Record<string, string> {
    const values: Record<string, string> = {
      ...credentials,
      ...transientValues,
    };
    for (const credential of operation.credentialVariables) {
      const value = credentials[credential.name];
      if (value === undefined) throw new ProviderConfigurationInvalidError();
      values[credential.name] = hydrateCredentialTemplate(
        credential.name,
        value,
        input,
      );
    }
    for (const name of operation.inputVariables) {
      if (values[name] === undefined)
        values[name] = inputVariableValue(name, input);
    }
    return values;
  }

  private async executeOperation(
    operation: ProviderOperationMetadata,
    credentials: Record<string, string>,
    input: CanonicalInput,
    transientValues: Record<string, string> = {},
  ): Promise<{ status: number; data: unknown }> {
    const values = this.valuesForOperation(
      operation,
      credentials,
      input,
      transientValues,
    );
    let url: URL;
    try {
      url = new URL(renderTemplate(operation.request.urlTemplate, values));
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Unsupported URL protocol");
      }
    } catch {
      throw new ProviderConfigurationInvalidError();
    }
    const headers = new Headers(
      operation.request.headers.map((header): [string, string] => [
        header.name,
        renderTemplate(header.valueTemplate, values),
      ]),
    );
    const descriptor = operation.request.body;
    let body: string | undefined;
    if (descriptor.mode !== "none") {
      if ("fields" in descriptor) {
        body = new URLSearchParams(
          descriptor.fields.map((field) => [
            field.name,
            renderTemplate(field.valueTemplate, values),
          ]),
        ).toString();
      } else if ("template" in descriptor) {
        body = renderTemplate(
          descriptor.template,
          values,
          descriptor.mode === "xml" ? xmlEscape : undefined,
        );
      } else {
        throw new ProviderConfigurationInvalidError();
      }
    }

    const preparation = {
      credentials: { ...credentials, ...values },
      fetcher: this.fetcher,
      url,
      headers,
      body,
    };
    await prepareProviderRequest(operation.id, preparation);
    body = preparation.body;

    let response: Response;
    try {
      response = await this.fetcher(
        new Request(url, { method: operation.method, headers, body }),
      );
    } catch {
      throw new ExternalProviderUpstreamError();
    }
    const data = await responseData(response);
    if (!response.ok) throw new ExternalProviderUpstreamError("response");
    return { status: response.status, data };
  }

  private async executeSbsProduct(
    operationId: SbsProductStartOperationId,
    credentials: Record<string, string>,
    input: CanonicalInput,
  ): Promise<{ status: number; data: unknown }> {
    return executeSbsProductFlow(operationId, (stepId, transientValues) =>
      this.executeOperation(
        requireProviderOperation(stepId),
        credentials,
        input,
        transientValues,
      ),
    );
  }
}
