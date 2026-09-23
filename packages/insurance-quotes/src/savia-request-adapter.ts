import { z } from "zod";
import type { ExtensionActionContext } from "@savia/studio-shared/extension-runtime";
import {
  insuranceQuotesActionId,
  insuranceQuotesExtensionId,
} from "./connectors";
import { normalizeInsuranceAction } from "./normalize";
import {
  insuranceSaviaRequestBundle,
  isInsuranceSaviaRequestFlow,
} from "./savia-request-bundle";
import { toSaviaRequestInput } from "./savia-request-input";

const quoteInputSchema = z
  .object({
    vehicle: z
      .object({
        plate: z.string().trim().min(1),
        fasecoldaCode: z.string().trim().min(1),
        productionYear: z.number().int(),
        isNew: z.boolean(),
        circulationCity: z.string().trim().min(1),
        accessoriesValue: z.number().finite().min(0),
        declaredValue: z.number().finite().positive(),
      })
      .strict(),
    applicant: z
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
      .strict(),
  })
  .strict();

const lookupQuoteInputSchema = z
  .object({
    vehicle: z.object({ plate: z.string().trim().min(1) }).passthrough(),
  })
  .passthrough();

const actionInputSchema = z
  .object({
    mode: z.enum(["mock", "live"]),
    flowId: z.string().trim().min(1),
    quoteInput: z.unknown(),
  })
  .strict();

const flowRunSchema = z
  .object({
    status: z.string(),
    result: z.unknown().nullable(),
  })
  .passthrough();

export type SaviaRequestService = {
  fetch(request: Request): Response | Promise<Response>;
};

type ConnectorActionInput = {
  context: ExtensionActionContext;
  connection: Record<string, unknown>;
  input: Record<string, unknown>;
};

function providerFor(flowId: string): string {
  const label = insuranceSaviaRequestBundle.flows.find(
    (flow) => flow.id === flowId,
  )?.label;
  return label?.split(" · ")[0] ?? "Seguros";
}

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
      const request = actionInputSchema.parse(input);
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
      const run = flowRunSchema.safeParse(body);
      if (!response.ok || !run.success || run.data.status !== "success")
        throw new Error("Savia Request no completó la ejecución.");
      return normalizeInsuranceAction(
        providerFor(request.flowId),
        request.flowId,
        run.data.result,
      );
    },
  };
}
