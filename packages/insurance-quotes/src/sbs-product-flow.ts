import { ExternalProviderUpstreamError } from "./errors";

export type SbsProductStepResult = {
  status: number;
  data: unknown;
};

export type ExecuteSbsProductStep = (
  operationId: string,
  transientValues?: Record<string, string>,
) => Promise<SbsProductStepResult>;

export const sbsProductFlows = {
  "sbs-product-8-quote": [
    "sbs-product-8-quote",
    "sbs-product-8-add-coverage-1",
    "sbs-product-8-add-coverage-2",
    "sbs-product-8-quote-and-close",
  ],
  "sbs-product-10-quote": [
    "sbs-product-10-quote",
    "sbs-product-10-add-coverage-1",
    "sbs-product-10-add-coverage-2",
    "sbs-product-10-add-coverage-3",
    "sbs-product-10-add-coverage-4",
    "sbs-product-10-add-coverage-5",
    "sbs-product-10-add-coverage-6",
    "sbs-product-10-add-coverage-7",
    "sbs-product-10-quote-and-close",
  ],
  "sbs-product-11-quote": [
    "sbs-product-11-quote",
    "sbs-product-11-add-coverage-1",
    "sbs-product-11-add-coverage-2",
    "sbs-product-11-add-coverage-3",
    "sbs-product-11-add-coverage-4",
    "sbs-product-11-add-coverage-5",
    "sbs-product-11-add-coverage-6",
    "sbs-product-11-add-coverage-7",
    "sbs-product-11-quote-and-close",
  ],
} as const;

export type SbsProductStartOperationId = keyof typeof sbsProductFlows;

function sessionIdFromSbsResponse(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.match(/<No_Sesion\b[^>]*>\s*([^<\s]+)\s*<\/No_Sesion>/i)?.[1];
}

function sessionVariableFor(operationId: SbsProductStartOperationId): string {
  return `${operationId.replace("-quote", "").replaceAll("-", "_")}_session_id`;
}

export async function executeSbsProductFlow(
  operationId: SbsProductStartOperationId,
  executeStep: ExecuteSbsProductStep,
): Promise<SbsProductStepResult> {
  const [createSession, ...remainingSteps] = sbsProductFlows[operationId];
  const created = await executeStep(createSession);
  const sessionId = sessionIdFromSbsResponse(created.data);
  if (!sessionId) throw new ExternalProviderUpstreamError("response");

  let completed = created;
  const transientValues = { [sessionVariableFor(operationId)]: sessionId };
  for (const step of remainingSteps)
    completed = await executeStep(step, transientValues);
  return completed;
}
