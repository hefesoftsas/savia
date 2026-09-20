import { HTTPException } from "hono/http-exception";
import { z } from "@hono/zod-openapi";
import type { ExtensionActionExecutor } from "@savia/crm-shared/extension-runtime";
import type { ExtensionRegistry } from "@savia/crm-shared/extension-package";
import { isExtensionAvailable } from "@savia/crm-server/extensions";
import { ExtensionSettingsRepository } from "@savia/crm-server/extension-settings";
import { ExtensionConnectionRepository } from "@savia/crm-server/extension-connections";
import { publicQuoteContribution as contribution } from "@savia/release-catalog/public-forms";
import { solutionOptions } from "../solutions/catalog";
import type { PublicQuoteAdapter } from "./service";

const extensionId = contribution.extensionId;
const policySchema = z
  .object({
    version: z.literal(1),
    publicationId: z.string().uuid(),
    tenant: z.string(),
    domainId: z.string(),
    objectName: z
      .string()
      .refine((name) => contribution.objectNames.includes(name)),
    extensionId: z.literal(extensionId),
    extensionVersion: z.string(),
    actionId: z.literal(contribution.actionId),
    mode: z.literal(contribution.mode),
    connectionId: z.literal(contribution.connectionId),
    settingsVersion: z.number().int().min(1),
    products: z
      .array(z.object({ flowId: z.string() }).strict())
      .min(1)
      .max(20),
  })
  .strict();
type Policy = z.infer<typeof policySchema>;
const catalog = new Map<string, (typeof contribution.products)[number]>(
  contribution.products.map((product) => [product.id, product]),
);
function policy(value: unknown): Policy {
  const parsed = policySchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.products.some((p) => !catalog.has(p.flowId)) ||
    new Set(parsed.data.products.map((p) => p.flowId)).size !==
      parsed.data.products.length
  )
    throw new HTTPException(422, {
      message: "La política pública de cotización no es válida.",
    });
  return parsed.data;
}
export function createPublicQuoteAdapter(options: {
  executor?: ExtensionActionExecutor;
  encryptionKey?: string;
  registry?: ExtensionRegistry;
}): PublicQuoteAdapter {
  const registry = options.registry ?? solutionOptions.extensionRegistry;
  const current = async (
    db: D1Database,
    tenant: string,
    objectName: string,
  ) => {
    if (
      !contribution.objectNames.includes(objectName) ||
      !(await isExtensionAvailable(db, tenant, extensionId, registry))
    )
      throw new HTTPException(404, {
        message: "El cotizador no está disponible.",
      });
    const repository = new ExtensionSettingsRepository(db, {
      isExtensionActive: (tenant, id) =>
        isExtensionAvailable(db, tenant, id, registry),
    });
    const stored = await repository.get(
      { tenantId: tenant, extensionId },
      contribution.settingsDefinition,
    );
    const settings = contribution.readSettings(stored.value, objectName);
    if (stored.version < 1 || !settings.enabled)
      throw new HTTPException(409, {
        message: "Configura y habilita el cotizador antes de publicar.",
      });
    return { stored, settings };
  };
  const assertAvailable: NonNullable<
    PublicQuoteAdapter["assertAvailable"]
  > = async ({ db, tenant, domainId, objectName, snapshot }) => {
    const frozen = policy(snapshot);
    if (
      frozen.tenant !== tenant ||
      frozen.domainId !== domainId ||
      frozen.objectName !== objectName
    )
      throw new HTTPException(404, {
        message: "El cotizador no está disponible.",
      });
    const { stored, settings } = await current(db, tenant, objectName);
    if (
      frozen.settingsVersion !== stored.version ||
      frozen.extensionVersion !== registry.get(extensionId)?.manifest.version ||
      frozen.products.some(
        (product) =>
          !settings.products.some(
            (current) => current.id === product.flowId && current.enabled,
          ),
      )
    )
      throw new HTTPException(409, {
        message: "La configuración cambió. Publica nuevamente el formulario.",
      });
  };
  async function presentation({
    objectName,
    snapshot,
  }: {
    objectName: string;
    snapshot: unknown;
  }) {
    const frozen = policy(snapshot);
    return {
      renderer: "insurance-quote-wizard" as const,
      entry: (objectName === "cotizador_por_pasos"
        ? "wizard"
        : "direct") as "wizard" | "direct",
      products: frozen.products.map(({ flowId }) => ({
        flowId,
        label: catalog.get(flowId)!.label,
      })),
    };
  }
  return {
    presentation,
    async publish({ db, tenant, domainId, object }) {
      if (!options.executor)
        throw new HTTPException(503, {
          message: "El servicio de cotización no está disponible.",
        });
      const { stored, settings } = await current(db, tenant, object.name);
      const products = settings.products
        .filter((p) => p.enabled && catalog.has(p.id))
        .sort((a, b) => a.rank - b.rank)
        .map((p) => ({ flowId: p.id }));
      const snapshot = policy({
        version: 1,
        publicationId: crypto.randomUUID(),
        tenant,
        domainId,
        objectName: object.name,
        extensionId,
        extensionVersion: registry.get(extensionId)!.manifest.version,
        actionId: contribution.actionId,
        mode: contribution.mode,
        connectionId: contribution.connectionId,
        settingsVersion: stored.version,
        products,
      });
      // Current trusted Savia Request quote flows own their credential configuration.
      // The optional extension connection settings are unused by the existing wizard.
      return { fields: structuredClone(contribution.fields), snapshot };
    },
    async validate({ snapshot, values }) {
      policy(snapshot);
      try {
        return contribution.validateValues(values);
      } catch {
        throw new HTTPException(422, {
          message: "Revisa los datos del vehículo y del solicitante.",
        });
      }
    },
    assertAvailable,
    async execute(input) {
      await assertAvailable(input);
      const frozen = policy(input.snapshot);
      if (!options.executor)
        throw new HTTPException(503, {
          message: "El servicio de cotización no está disponible.",
        });
      let values: Record<string, unknown>;
      try {
        values = contribution.validateValues(input.values);
      } catch {
        throw new HTTPException(422, {
          message: "Revisa los datos del vehículo y del solicitante.",
        });
      }
      const submission = z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,80}$/)
        .parse(input.submissionId);
      const runs = new ExtensionConnectionRepository(input.db, {
        encryptionKey: options.encryptionKey,
        isExtensionActive: (tenant, id) =>
          isExtensionAvailable(input.db, tenant, id, registry),
      });
      const quotes: ReturnType<typeof contribution.projectResult>[] = [];
      let unavailable = 0;
      for (const product of frozen.products) {
        const context = {
          tenantId: input.tenant,
          principalId: `public-form:${submission}`,
          extensionId,
          actionId: contribution.actionId,
          connectionId: frozen.connectionId,
          runId: `public:${frozen.publicationId}:${submission}:${product.flowId}`,
        };
        const actionInput = contribution.actionInput(product.flowId, values);
        await runs.startRun(context, actionInput);
        try {
          const result = await options.executor.execute(context, actionInput);
          if (result.status !== "succeeded")
            throw new Error("Quote unavailable");
          const safe = contribution.projectResult(
            product.flowId,
            result.output,
          );
          await runs.completeRun(context, safe);
          quotes.push(safe);
        } catch {
          await runs.failRun(context, "CONNECTOR_EXECUTION_FAILED");
          unavailable++;
        }
      }
      if (!quotes.length)
        throw new HTTPException(502, {
          message: "No se pudo completar la cotización. Intenta más tarde.",
        });
      return input.returnResult ? { quotes, unavailable } : undefined;
    },
  };
}
