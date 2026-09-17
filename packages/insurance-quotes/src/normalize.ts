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
