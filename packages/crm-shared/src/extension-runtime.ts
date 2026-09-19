import { z } from "zod";
import { solutionIdSchema } from "./solution-package";

export const extensionConnectionIdSchema = solutionIdSchema;

export const extensionActionContextSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(200),
    principalId: z.string().trim().min(1).max(200),
    extensionId: solutionIdSchema,
    actionId: solutionIdSchema,
    connectionId: extensionConnectionIdSchema,
    runId: z.string().trim().min(1).max(200),
  })
  .strict();

export type ExtensionActionContext = z.infer<
  typeof extensionActionContextSchema
>;

export type ExtensionActionExecutor = {
  execute(
    context: ExtensionActionContext,
    input: Record<string, unknown>,
  ): Promise<{ output: unknown; status: "succeeded" | "failed" }>;
};

export type ExtensionConnectorDefinition = {
  extensionId: string;
  connectorId: string;
  label: string;
  configurationSchema: z.ZodType<Record<string, unknown>>;
  secretFields: readonly string[];
};

export type ExtensionActionDefinition = {
  extensionId: string;
  actionId: string;
  connectorId: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  connectionOptional?: boolean;
};

export type ExtensionSettingsDefinition = {
  extensionId: string;
  schema: z.ZodType<Record<string, unknown>>;
  defaults: Record<string, unknown>;
};

export type ExtensionRuntimeContribution = {
  connectors?: readonly ExtensionConnectorDefinition[];
  actions?: readonly ExtensionActionDefinition[];
  settings?: ExtensionSettingsDefinition;
};

function validateIdentifier(value: string, label: string): void {
  solutionIdSchema.parse(value);
  if (value !== value.trim()) throw new Error(`${label} no es válido.`);
}

function validateFieldName(value: string): void {
  if (!value.trim() || value !== value.trim() || value.length > 100)
    throw new Error("El campo secreto no es válido.");
}

function objectShape(schema: z.ZodType<Record<string, unknown>>) {
  if (!(schema instanceof z.ZodObject))
    throw new Error("La configuración del conector debe ser un objeto Zod.");
  return schema.shape;
}

export function validateExtensionRuntime(
  extensionId: string,
  runtime: ExtensionRuntimeContribution | undefined,
): ExtensionRuntimeContribution | undefined {
  if (!runtime) return undefined;
  const connectors = runtime.connectors ?? [];
  const actions = runtime.actions ?? [];
  const settings = runtime.settings;
  const connectorIds = new Set<string>();
  const actionIds = new Set<string>();

  if (settings) {
    if (settings.extensionId !== extensionId)
      throw new Error("La configuración pertenece a otra extensión.");
    settings.schema.parse(settings.defaults);
  }

  for (const connector of connectors) {
    if (connector.extensionId !== extensionId)
      throw new Error("El conector pertenece a otra extensión.");
    validateIdentifier(connector.connectorId, "El identificador de conector");
    if (!connector.label.trim())
      throw new Error("El conector requiere etiqueta.");
    if (connectorIds.has(connector.connectorId))
      throw new Error(`El conector ${connector.connectorId} está duplicado.`);
    connectorIds.add(connector.connectorId);
    const shape = objectShape(connector.configurationSchema);
    for (const field of connector.secretFields) {
      validateFieldName(field);
      if (!(field in shape))
        throw new Error(
          `El campo secreto ${field} no está en la configuración.`,
        );
    }
  }

  for (const action of actions) {
    if (action.extensionId !== extensionId)
      throw new Error("La acción pertenece a otra extensión.");
    validateIdentifier(action.actionId, "El identificador de acción");
    if (actionIds.has(action.actionId))
      throw new Error(`La acción ${action.actionId} está duplicada.`);
    actionIds.add(action.actionId);
    if (!connectorIds.has(action.connectorId))
      throw new Error(
        `La acción usa el conector no declarado ${action.connectorId}.`,
      );
  }

  return { connectors, actions, ...(settings ? { settings } : {}) };
}
