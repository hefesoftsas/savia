import type { AutoLightQuoteInput } from "./screens/quote-input";
import {
  insuranceSaviaRequestBundle,
  isInsuranceSaviaRequestFlow,
} from "./savia-request-bundle";

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
  throw new Error("El flow de Seguros no se puede ejecutar desde el cotizador.");
}
