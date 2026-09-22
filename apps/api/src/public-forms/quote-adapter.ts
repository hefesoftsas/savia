import { HTTPException } from "hono/http-exception";
import { z } from "@hono/zod-openapi";
import type { ExtensionActionExecutor } from "@savia/crm-shared/extension-runtime";
import type { ExtensionRegistry } from "@savia/crm-shared/extension-package";
import { isExtensionAvailable } from "@savia/crm-server/extensions";
import { ExtensionSettingsRepository } from "@savia/crm-server/extension-settings";
import { ExtensionConnectionRepository } from "@savia/crm-server/extension-connections";
import {
  createRecord,
  getRecord,
  updateRecord,
} from "@savia/crm-server/services";
import { historyDatabase } from "@savia/crm-server/record-history-storage";
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
/**
 * Anonymous visitors wait on a single response, so providers run in parallel.
 * The bound keeps upstream throttling and run-receipt writes predictable;
 * wall time is the slowest wave, not the sum of all products.
 */
export const PUBLIC_QUOTE_CONCURRENCY = 10;
/**
 * Bounded parallel map preserving input order. Provider calls are
 * independent (each keeps its own run receipt), so concurrency only
 * shortens the visitor wait instead of changing the result.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item === undefined) break;
        results[index] = await task(item, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

type QuoteMirror = {
  db: D1Database;
  masterId: string;
  masterVersion: number;
  details: Map<string, { id: string; version: number }>;
};

function storedVersion(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const version = (value as Record<string, unknown>)._version;
  return typeof version === "number" && Number.isInteger(version) && version > 0
    ? version
    : undefined;
}

function storedId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id ? id : undefined;
}

/**
 * Agency-visible CRM mirror of an anonymous submission: one `cotizaciones`
 * master plus one `cotizaciones_detalle` per enabled product, using the same
 * fields as the embedded wizard so history and reports keep working. The
 * visitor never sees these records; the public reference (submission id) is
 * the master name so the agency can match it. Writes are best-effort and
 * idempotent per submission: the quote still succeeds when the collections
 * are missing, and uncertain retries replay the same rows instead of
 * duplicating them. Provider quote references are deliberately not mirrored
 * (they can embed plates or document numbers).
 */
async function createQuoteMirror(input: {
  db: D1Database;
  tenant: string;
  submission: string;
  publicationId: string;
  values: Record<string, unknown>;
  products: readonly { flowId: string }[];
}): Promise<QuoteMirror | null> {
  const { db, tenant, submission, publicationId, values, products } = input;
  try {
    const hdb = historyDatabase(db, tenant, {
      kind: "public-form",
      id: publicationId,
      causeId: submission,
    });
    const createdBy = `public-form:${submission}`;
    const masterRow = await createRecord(
      hdb,
      tenant,
      "cotizaciones",
      {
        name: submission,
        ramo: "Automóviles",
        placa: values["vehicle_plate"],
        valor_asegurado: values["vehicle_declaredValue"],
        estado: "Solicitada",
      },
      {
        idempotencyKey: `public-quote:${publicationId}:${submission}:master`,
        createdBy,
      },
    );
    const master = await getRecord(
      hdb,
      tenant,
      "cotizaciones",
      storedId(masterRow) ?? "",
    );
    const masterId = storedId(master);
    const masterVersion = storedVersion(master);
    if (!masterId || masterVersion === undefined) return null;
    const details = new Map<string, { id: string; version: number }>();
    for (const product of products) {
      const label = catalog.get(product.flowId)?.label ?? product.flowId;
      const detailRow = await createRecord(
        hdb,
        tenant,
        "cotizaciones_detalle",
        {
          name: `${submission}-${product.flowId}`,
          cotizacion: masterId,
          aseguradora: label.split(" · ")[0] ?? "Seguros",
          producto: label,
          flow_id: product.flowId,
          estado: "Solicitada",
        },
        {
          idempotencyKey: `public-quote:${publicationId}:${submission}:${product.flowId}`,
          createdBy,
        },
      );
      const detail = await getRecord(
        hdb,
        tenant,
        "cotizaciones_detalle",
        storedId(detailRow) ?? "",
      );
      const detailId = storedId(detail);
      const detailVersion = storedVersion(detail);
      if (detailId && detailVersion !== undefined)
        details.set(product.flowId, { id: detailId, version: detailVersion });
    }
    return { db: hdb, masterId, masterVersion, details };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "public-form-quote-mirror-failed",
        tenant,
        submission,
      }),
    );
    return null;
  }
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
    // Local simulation: every valid plate resolves to fixed fixture data so
    // the lookup UX can be exercised without provider credentials. The
    // fixture is intentionally constant — it can never be mistaken for a
    // real provider response.
    if (options.mockProviders)
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
    async quoteStatus({
      db,
      tenant,
      domainId,
      objectName,
      snapshot,
      submission,
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
      // Run receipts are the progress source: each redemption writes its own
      // row under a distinct run id, so polling never touches provider flows.
      // The run id prefix scopes rows to this published policy, since visitor
      // submission ids alone are not form-scoped.
      const prefix = `public:${frozen.publicationId}:${submission}:`;
      const runs = await db
        .prepare(
          "SELECT run_id,status,output FROM extension_action_runs WHERE tenant_id=? AND principal_id=?",
        )
        .bind(tenant, `public-form:${submission}`)
        .all<{ run_id: string; status: string; output: string | null }>();
      const byFlow = new Map<string, { status: string; result?: unknown }>();
      for (const row of runs.results ?? []) {
        if (!row.run_id.startsWith(prefix)) continue;
        const flowId = row.run_id.slice(prefix.length);
        if (!flowId || flowId.includes(":")) continue;
        let result: unknown;
        if (row.status === "succeeded") {
          try {
            result = row.output ? JSON.parse(row.output) : undefined;
          } catch {
            result = undefined;
          }
        }
        byFlow.set(flowId, {
          status: row.status,
          ...(result !== undefined ? { result } : {}),
        });
      }
      return {
        items: frozen.products.map(({ flowId }) => {
          const label = catalog.get(flowId)!.label;
          const insurer = label.split(" · ")[0] ?? "Seguros";
          const run = byFlow.get(flowId);
          if (!run)
            return { flowId, label, insurer, status: "waiting" as const };
          if (run.status === "succeeded")
            return {
              flowId,
              label,
              insurer,
              status: "done" as const,
              ...(run.result !== undefined ? { result: run.result } : {}),
            };
          if (run.status === "failed" || run.status === "expired")
            return { flowId, label, insurer, status: "unavailable" as const };
          return { flowId, label, insurer, status: "quoting" as const };
        }),
      };
    },
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
            flowId,
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
      // The guard above narrows options.executor for straight-line code;
      // capture it so the parallel closure below stays typed as defined.
      const executor = options.executor;
      // Agency-visible CRM mirror (best-effort): the visitor-facing result
      // never depends on it.
      const mirror = await createQuoteMirror({
        db: input.db,
        tenant: input.tenant,
        submission,
        publicationId: frozen.publicationId,
        values,
        products: frozen.products,
      });
      const outcomes = await mapWithConcurrency(
        frozen.products,
        PUBLIC_QUOTE_CONCURRENCY,
        async (product) => {
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
          const mirrorDetail = mirror?.details.get(product.flowId);
          let detailVersion = mirrorDetail?.version;
          try {
            const result = await executor.execute(context, actionInput);
            if (result.status !== "succeeded") {
              // Executor failure codes come from a fixed public set; safe to log.
              const output = result.output as { code?: unknown } | undefined;
              console.error(
                JSON.stringify({
                  event: "public-form-quote-product-failed",
                  tenant: input.tenant,
                  submission,
                  flowId: product.flowId,
                  code:
                    typeof output?.code === "string"
                      ? output.code
                      : "CONNECTOR_EXECUTION_FAILED",
                }),
              );
              throw new Error("Quote unavailable");
            }
            const safe = contribution.projectResult(
              product.flowId,
              result.output,
            );
            await runs.completeRun(context, safe);
            if (mirror && mirrorDetail && detailVersion !== undefined) {
              try {
                const updated = await updateRecord(
                  mirror.db,
                  input.tenant,
                  "cotizaciones_detalle",
                  mirrorDetail.id,
                  {
                    estado: "Recibida",
                    prima: safe.premiumTotal ?? undefined,
                    run_id: context.runId,
                    error_mensaje: undefined,
                  },
                  { version: detailVersion },
                );
                detailVersion = storedVersion(updated) ?? detailVersion + 1;
              } catch {}
            }
            return safe;
          } catch {
            await runs.failRun(context, "CONNECTOR_EXECUTION_FAILED");
            if (mirror && mirrorDetail && detailVersion !== undefined) {
              try {
                const updated = await updateRecord(
                  mirror.db,
                  input.tenant,
                  "cotizaciones_detalle",
                  mirrorDetail.id,
                  {
                    estado: "Error",
                    error_mensaje: "El conector no pudo completar la acción.",
                  },
                  { version: detailVersion },
                );
                detailVersion = storedVersion(updated) ?? detailVersion + 1;
              } catch {}
            }
            return null;
          }
        },
      );
      const quotes = outcomes.filter(
        (quote): quote is NonNullable<(typeof outcomes)[number]> =>
          quote !== null,
      );
      const unavailable = outcomes.length - quotes.length;
      if (mirror) {
        try {
          const validPremiums = quotes
            .map((quote) => quote.premiumTotal)
            .filter(
              (premium): premium is number =>
                typeof premium === "number" && premium > 0,
            );
          await updateRecord(
            mirror.db,
            input.tenant,
            "cotizaciones",
            mirror.masterId,
            {
              estado: quotes.length ? "Recibida" : "Rechazada",
              ...(validPremiums.length
                ? { prima: Math.min(...validPremiums) }
                : {}),
            },
            { version: mirror.masterVersion },
          );
        } catch {}
      }
      if (!quotes.length)
        throw new HTTPException(502, {
          message: "No se pudo completar la cotización. Intenta más tarde.",
        });
      return input.returnResult ? { quotes, unavailable } : undefined;
    },
  };
}
