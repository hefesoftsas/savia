import type { ExtensionActionContext } from "@savia/crm-shared/extension-runtime";
import { normalizeInsuranceAction } from "./normalize";
import { ProviderExecutor } from "./provider-executor";

export const insuranceQuotesExtensionId = "insurance.quotes";
export const insuranceQuotesConnectorId = "insurance.quotes.provider";
export const insuranceQuotesActionId = "quote";

type ProviderQuoteResponse = {
  status: number;
  data: unknown;
};

type ProviderQuoteExecutor = (input: {
  provider: string;
  credentials: Record<string, unknown>;
  quoteInput: Record<string, unknown>;
}) => Promise<ProviderQuoteResponse>;

type InsuranceQuotesOptions = {
  executeProviderQuote?: ProviderQuoteExecutor;
  fetcher?: typeof fetch;
};

function connectionValues(value: Record<string, unknown> | undefined) {
  if (!value) throw new Error("La conexión de cotización no es válida.");
  const provider = value.provider;
  const credentials = value.credentials;
  if (
    typeof provider !== "string" ||
    !provider.trim() ||
    !credentials ||
    typeof credentials !== "object" ||
    Array.isArray(credentials)
  ) {
    throw new Error("La conexión de cotización no es válida.");
  }
  return {
    provider: provider.trim(),
    credentials: credentials as Record<string, unknown>,
  };
}

export type InsuranceQuotes = {
  action(actionId: string, connectorId: string): void;
  execute(
    context: ExtensionActionContext,
    quoteInput: Record<string, unknown>,
    connection?: Record<string, unknown>,
  ): Promise<{ output: unknown; status: "succeeded" }>;
};

function operationIdFrom(input: Record<string, unknown>): string {
  const operationId = input.operationId;
  if (typeof operationId !== "string" || !operationId.trim())
    throw new Error("La cotización debe indicar la operación del proveedor.");
  return operationId;
}

function simulatedResponse(operationId: string, input: Record<string, unknown>) {
  const vehicle = input.vehicle;
  const plate =
    vehicle &&
    typeof vehicle === "object" &&
    !Array.isArray(vehicle) &&
    typeof (vehicle as Record<string, unknown>).plate === "string"
      ? (vehicle as Record<string, string>).plate.trim().toUpperCase()
      : "AUTO";
  if (operationId === "sura-vehicle-by-plate")
    return {
      plate,
      modelo: 2024,
      fasecolda: "SIM-2024",
      valorAsegurado: 50000000,
      valorAccesorios: 0,
      simulated: true,
    };
  return {
    quoteNumber: `SIM-${plate}-${operationId}`,
    premiumTotal: 1200000,
    currency: "COP",
    simulated: true,
  };
}

function isSimulation(input: Record<string, unknown>): boolean {
  return input.mode === "mock";
}

function providerInput(input: Record<string, unknown>): Record<string, unknown> {
  const { mode: _mode, ...rest } = input;
  return rest;
}

export function createInsuranceQuotes(
  options: InsuranceQuotesOptions = {},
): InsuranceQuotes {
  const providerExecutor = new ProviderExecutor({ fetcher: options.fetcher });
  const executeProviderQuote =
    options.executeProviderQuote ??
    (async ({ provider, credentials, quoteInput }) => {
      const operationId = quoteInput.operationId;
      if (typeof operationId !== "string" || !operationId.trim())
        throw new Error(
          "La cotización debe indicar la operación del proveedor.",
        );
      return providerExecutor.execute(
        provider,
        operationId,
        quoteInput,
        credentials,
      );
    });

  return {
    action(actionId, connectorId) {
      if (actionId !== insuranceQuotesActionId)
        throw new Error(`La acción ${actionId} no está disponible.`);
      if (connectorId !== insuranceQuotesConnectorId)
        throw new Error(
          `La acción quote requiere el conector ${insuranceQuotesConnectorId}.`,
        );
    },
    async execute(context, quoteInput, connection) {
      if (
        context.extensionId !== insuranceQuotesExtensionId ||
        context.actionId !== insuranceQuotesActionId
      ) {
        throw new Error("El contexto de cotización no es válido.");
      }
      const operationId = operationIdFrom(quoteInput);
      if (isSimulation(quoteInput)) {
        return {
          status: "succeeded",
          output: normalizeInsuranceAction(
            "simulation",
            operationId,
            simulatedResponse(operationId, quoteInput),
          ),
        };
      }
      const configured = connectionValues(connection);
      const response = await executeProviderQuote({
        provider: configured.provider,
        credentials: configured.credentials,
        quoteInput: providerInput(quoteInput),
      });
      if (response.status < 200 || response.status >= 300)
        throw new Error("El proveedor rechazó la cotización.");
      return {
        status: "succeeded",
        output: normalizeInsuranceAction(
          configured.provider,
          operationId,
          response.data,
        ),
      };
    },
  };
}

export const insuranceQuotes = createInsuranceQuotes();

export const insuranceQuotesConnectorAction = {
  extensionId: insuranceQuotesExtensionId,
  actionId: insuranceQuotesActionId,
  requiresConnection(input: Record<string, unknown>) {
    return !isSimulation(input);
  },
  async execute(input: {
    context: ExtensionActionContext;
    connection: Record<string, unknown>;
    input: Record<string, unknown>;
  }) {
    return (
      await insuranceQuotes.execute(
        input.context,
        input.input,
        input.connection,
      )
    ).output;
  },
};
