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
  /**
   * Local-development simulation with fixture data (no provider calls, no
   * run receipts). The caller must only enable it for localhost origins;
   * preview and production never set it.
   */
  mockProviders?: boolean;
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
      entry: (objectName === "cotizador_por_pasos" ? "wizard" : "direct") as
        "wizard" | "direct",
      products: frozen.products.map(({ flowId }) => ({
        flowId,
        label: catalog.get(flowId)!.label,
      })),
    };
  }
  async function lookupVehicle({
    db,
    tenant,
    domainId,
    objectName,
    snapshot,
    plate,
  }: {
    db: D1Database;
    tenant: string;
    domainId: string;
    objectName: string;
    snapshot: unknown;
    plate: string;
  }) {
    const frozen = policy(snapshot);
    if (
      frozen.tenant !== tenant ||
      frozen.domainId !== domainId ||
      frozen.objectName !== objectName
    )
      throw new HTTPException(404, {
        message: "El cotizador no está disponible.",
      });
    const normalized = plate.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,10}$/.test(normalized))
      throw new HTTPException(422, { message: "Revisa la placa." });
    // The lookup flow follows the current trusted settings, not visitor input:
    // visitors can never select actions, connections, or flows.
    const { stored } = await current(db, tenant, objectName);
    if (frozen.settingsVersion !== stored.version)
      throw new HTTPException(409, {
        message: "La configuración cambió. Publica nuevamente el formulario.",
      });
    const vehicleLookup = contribution.readVehicleLookup(stored.value);
    if (!vehicleLookup.enabled)
      throw new HTTPException(409, {
        message:
          "La consulta de placa no está disponible. Completa los datos manualmente.",
      });
    // Local simulation for the documented demo plate only; every other plate
    // still goes through the real provider flow.
    if (options.mockProviders && normalized === "TESTCAR")
      return {
        plate: normalized,
        fasecoldaCode: "00000000",
        productionYear: 2024,
        declaredValue: 50000000,
        accessoriesValue: 0,
      };
    if (!options.executor)
      throw new HTTPException(503, {
        message: "El servicio de cotización no está disponible.",
      });
    const context = {
      tenantId: tenant,
      principalId: "public-form:vehicle-lookup",
      extensionId,
      actionId: contribution.actionId,
      connectionId: contribution.connectionId,
      // Lookups are idempotent reads without a submission identity, so each
      // call gets a unique run receipt for audit instead of colliding.
      runId: `public:${frozen.publicationId}:lookup:${normalized}:${crypto.randomUUID()}`,
    };
    const actionInput = {
      mode: "live",
      flowId: vehicleLookup.flowId,
      quoteInput: { vehicle: { plate: normalized } },
    };
    const runs = new ExtensionConnectionRepository(db, {
      encryptionKey: options.encryptionKey,
      isExtensionActive: (activeTenant, id) =>
        isExtensionAvailable(db, activeTenant, id, registry),
    });
    await runs.startRun(context, actionInput);
    try {
      const result = await options.executor.execute(context, actionInput);
      if (result.status !== "succeeded") throw new Error("Lookup unavailable");
      const vehicle = (result.output as { data?: { vehicle?: unknown } })?.data
        ?.vehicle;
      if (!vehicle || typeof vehicle !== "object" || Array.isArray(vehicle))
        throw new HTTPException(404, {
          message: "No se encontraron datos para esa placa.",
        });
      const record = vehicle as Record<string, unknown>;
      if (record.plate !== normalized)
        throw new HTTPException(404, {
          message: "No se encontraron datos para esa placa.",
        });
      // Only fixed vehicle fields are projected; raw provider output stays hidden.
      const safe = {
        plate: normalized,
        ...(typeof record.fasecoldaCode === "string" && record.fasecoldaCode
          ? { fasecoldaCode: record.fasecoldaCode }
          : {}),
        ...(typeof record.productionYear === "number"
          ? { productionYear: record.productionYear }
          : {}),
        ...(typeof record.declaredValue === "number"
          ? { declaredValue: record.declaredValue }
          : {}),
        ...(typeof record.accessoriesValue === "number"
          ? { accessoriesValue: record.accessoriesValue }
          : {}),
      };
      await runs.completeRun(context, safe);
      return safe;
    } catch (error) {
      if (error instanceof HTTPException && error.status === 404) {
        await runs.failRun(context, "CONNECTOR_EXECUTION_FAILED");
        throw error;
      }
      await runs.failRun(context, "CONNECTOR_EXECUTION_FAILED");
      throw new HTTPException(502, {
        message: "No se pudo consultar la placa. Intenta más tarde.",
      });
    }
  }
  return {
    presentation,
    lookupVehicle,
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
      // Local simulation: fixture result derived from the frozen products, so
      // the full submit/receipt flow can be exercised without providers.
      if (options.mockProviders) {
        try {
          contribution.validateValues(input.values);
        } catch {
          throw new HTTPException(422, {
            message: "Revisa los datos del vehículo y del solicitante.",
          });
        }
        const quotes = frozen.products.map(({ flowId }) => {
          const label = catalog.get(flowId)!.label;
          return {
            insurer: label.split(" · ")[0],
            product: label,
            premiumTotal: 1250000,
            currency: "COP" as const,
            coverages: ["Responsabilidad civil", "Asistencia en carretera"],
          };
        });
        return input.returnResult ? { quotes, unavailable: 0 } : undefined;
      }
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
