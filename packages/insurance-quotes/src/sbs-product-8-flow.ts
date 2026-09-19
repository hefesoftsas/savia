import {
  executeSbsProductFlow,
  sbsProductFlows,
  type ExecuteSbsProductStep,
  type SbsProductStepResult,
} from "./sbs-product-flow";

export type SbsProduct8StepResult = SbsProductStepResult;

export type ExecuteSbsProduct8Step = ExecuteSbsProductStep;

export const sbsProduct8Flow = {
  id: "sbs-product-8-quote",
  steps: sbsProductFlows["sbs-product-8-quote"],
} as const;

export async function executeSbsProduct8Flow(
  executeStep: ExecuteSbsProduct8Step,
): Promise<SbsProduct8StepResult> {
  return executeSbsProductFlow("sbs-product-8-quote", executeStep);
}
