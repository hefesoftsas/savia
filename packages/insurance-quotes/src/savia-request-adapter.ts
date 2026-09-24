import { z } from "zod";
import type { ExtensionActionContext } from "@savia/studio-shared/extension-runtime";
import {
  insuranceQuotesActionId,
  insuranceQuotesExtensionId,
} from "./connectors";
import {
  insuranceSaviaRequestBundle,
  isInsuranceSaviaRequestFlow,
  lookupQuoteInputSchema,
  normalizeInsuranceAction,
  providerForFlow,
  quoteInputSchema,
  saviaRequestActionInputSchema,
  saviaRequestFlowRunSchema,
  toSaviaRequestInput,
  type SaviaRequestService,
} from "@savia/studio-shared/savia-request-quotes";

export type { SaviaRequestService };

type ConnectorActionInput = {
  context: ExtensionActionContext;
  connection: Record<string, unknown>;
  input: Record<string, unknown>;
};

export function createInsuranceSaviaRequestConnectorAction(
  service: SaviaRequestService | undefined,
) {
  return {
    extensionId: insuranceQuotesExtensionId,
    actionId: insuranceQuotesActionId,
    requiresConnection: () => false,
    async execute({ context, input }: ConnectorActionInput): Promise<unknown> {
      if (
        context.extensionId !== insuranceQuotesExtensionId ||
        context.actionId !== insuranceQuotesActionId
      )
        throw new Error("El contexto de cotización no es válido.");
      const request = saviaRequestActionInputSchema.parse(input);
      if (!isInsuranceSaviaRequestFlow(request.flowId))
        throw new Error("Flow de Seguros no permitido.");
      const isLookup =
        insuranceSaviaRequestBundle.flows.find(
          (flow) => flow.id === request.flowId,
        )?.role === "lookup";
      const quoteInput = isLookup
        ? lookupQuoteInputSchema.parse(request.quoteInput)
        : quoteInputSchema.parse(request.quoteInput);
      if (!service) throw new Error("Savia Request no está disponible.");

      let response: Response;
      try {
        response = await service.fetch(
          new Request(
            `https://savia-request.internal/api/flows/${request.flowId}/runs?tenant=${encodeURIComponent(context.tenantId)}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-savia-tenant": context.tenantId,
                "x-savia-actor": context.principalId,
              },
              body: JSON.stringify({
                mode: request.mode,
                input: toSaviaRequestInput(request.flowId, quoteInput as never),
              }),
            },
          ),
        );
      } catch {
        throw new Error("Savia Request no está disponible.");
      }
      const body = await response.json().catch(() => null);
      const run = saviaRequestFlowRunSchema.safeParse(body);
      if (!response.ok || !run.success || run.data.status !== "success")
        throw new Error("Savia Request no completó la ejecución.");
      return normalizeInsuranceAction(
        providerForFlow(request.flowId),
        request.flowId,
        run.data.result,
      );
    },
  };
}
