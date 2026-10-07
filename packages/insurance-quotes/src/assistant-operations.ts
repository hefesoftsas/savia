import {
  assistantQuoteInputSchema,
  assistantQuoteForm,
} from "./assistant-contract";
import type {
  PublicQuoteFact,
  PublicQuoteProposal,
} from "@savia/studio-shared/public-quote";
const encode = encodeURIComponent;
export type InsuranceAssistantPorts = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  resolveStudioTenantId(): Promise<number>;
  listStudioCollectionsForTenant(
    tenantId: number,
    options: { all: boolean },
  ): Promise<{ data: Array<Record<string, unknown>> }>;
  studioPath(tenantId: number, path: string): string;
};
export type InsuranceQuoteProgress = {
  productId: string;
  provider: string;
  product: string;
  premium?: number;
  quoteNumber?: string;
  state: "priced" | "unpriced" | "failed" | "uncertain";
  reference: string;
  quoteId: string;
  facts?: PublicQuoteFact[];
};
export type InsuranceExecutionOptions = {
  executionKey?: string;
  expectedProductIds?: readonly string[];
  onProgress?(progress: InsuranceQuoteProgress): Promise<void> | void;
  linkOwnership?(quoteId: string): Promise<void>;
  claimDispatch?(productId: string): Promise<boolean>;
  /** Provider actions default to 30s; persistence requests default to 15s, within a 90s total budget. */
  executionTimeouts?: {
    requestMs?: number;
    providerMs?: number;
    budgetMs?: number;
  };
};

const WHATSAPP_REQUEST_TIMEOUT_MS = 15_000;
const WHATSAPP_PROVIDER_TIMEOUT_MS = 30_000;
const WHATSAPP_EXECUTION_BUDGET_MS = 90_000;

const PROVIDER_COVERAGE_FACTS = [
  ["rce", "Responsabilidad civil (RCE)"],
  ["partialLossDeductible", "Deducible por pérdida parcial"],
  ["totalLossDeductible", "Deducible por pérdida total"],
  ["replacementCar", "Vehículo de reemplazo"],
  ["craneAssistance", "Grúa"],
  ["designatedDriver", "Conductor elegido"],
  ["medicalExpenses", "Gastos médicos"],
  ["legalAssistance", "Asistencia jurídica"],
  ["workshop", "Taller"],
] as const;

function providerCoverageFacts(value: unknown): PublicQuoteFact[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const coverages = value as Record<string, unknown>;
  return PROVIDER_COVERAGE_FACTS.flatMap(([key, label]) => {
    const raw = coverages[key];
    const text =
      typeof raw === "string"
        ? raw.trim()
        : typeof raw === "number" && Number.isFinite(raw)
          ? String(raw)
          : "";
    if (!text || text.length > 250) return [];
    return [{ label, value: text, source: "provider" as const }];
  });
}

class QuoteExecutionTimeoutError extends Error {
  constructor(
    readonly phase: string,
    readonly deadlineExpired: boolean,
  ) {
    super(
      deadlineExpired
        ? "Quote execution budget expired"
        : "Quote request timed out",
    );
    this.name = "QuoteExecutionTimeoutError";
  }
}

function boundedTimeout(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value! > 0
    ? Math.min(Math.floor(value!), fallback)
    : fallback;
}
export class InsuranceAssistantOperations {
  constructor(private readonly ports: InsuranceAssistantPorts) {}
  async lookupQuoteVehicle(plate: string) {
    const normalized = plate.trim().toUpperCase();
    if (!/^[A-Z0-9]{5,8}$/.test(normalized))
      throw new Error("Indica una placa válida.");
    const tenantId = await this.ports.resolveStudioTenantId();
    const settings = await this.ports.request<{
      data: { value: { vehicleLookup: { enabled: boolean; flowId: string } } };
    }>(this.ports.studioPath(tenantId, "extensions/insurance.quotes/settings"));
    const lookup = settings.data.value.vehicleLookup;
    if (!lookup?.enabled)
      throw new Error("La consulta de placa no está habilitada.");
    if (lookup.flowId !== "sura-autos-provider")
      throw new Error(
        "La consulta de placa configurada aún no está disponible para el asistente.",
      );
    const response = await this.ports.request<{
      data: { output: { data?: { vehicle?: Record<string, unknown> } } };
    }>(
      this.ports.studioPath(
        tenantId,
        "extensions/insurance.quotes/actions/quote",
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            mode: "live",
            flowId: lookup.flowId,
            quoteInput: { vehicle: { plate: normalized } },
          },
        }),
      },
    );
    const vehicle = response.data.output?.data?.vehicle;
    if (!vehicle || vehicle.plate !== normalized)
      throw new Error("No se encontraron datos verificados para esa placa.");
    return {
      source: lookup.flowId,
      vehicle: Object.fromEntries(
        [
          "plate",
          "fasecoldaCode",
          "productionYear",
          "declaredValue",
          "accessoriesValue",
        ]
          .filter((key) => vehicle[key] !== undefined)
          .map((key) => [key, vehicle[key]]),
      ),
    };
  }

  async getInsuranceQuoteForm() {
    const tenantId = await this.ports.resolveStudioTenantId();
    return this.getInsuranceQuoteFormForTenant(tenantId);
  }

  private async getInsuranceQuoteFormForTenant(tenantId: number) {
    const settings = await this.ports.request<{
      data: {
        value: {
          products: Array<{ id: string; label: string; enabled: boolean }>;
        };
      };
    }>(this.ports.studioPath(tenantId, "extensions/insurance.quotes/settings"));
    return {
      ...assistantQuoteForm,
      products: settings.data.value.products
        .filter((p) => p.enabled)
        .map((p) => ({ id: p.id, label: p.label })),
    };
  }

  async createInsuranceQuote(
    rawInput: unknown,
    options: InsuranceExecutionOptions = {},
  ) {
    const quoteStartedAt = Date.now();
    const executionMode = Boolean(options.executionKey);
    const requestTimeoutMs = executionMode
      ? boundedTimeout(
          options.executionTimeouts?.requestMs,
          WHATSAPP_REQUEST_TIMEOUT_MS,
        )
      : Number.POSITIVE_INFINITY;
    const providerTimeoutMs = executionMode
      ? boundedTimeout(
          options.executionTimeouts?.providerMs,
          WHATSAPP_PROVIDER_TIMEOUT_MS,
        )
      : Number.POSITIVE_INFINITY;
    const executionDeadline = executionMode
      ? quoteStartedAt +
        boundedTimeout(
          options.executionTimeouts?.budgetMs,
          WHATSAPP_EXECUTION_BUDGET_MS,
        )
      : Number.POSITIVE_INFINITY;
    const remainingExecutionMs = () => executionDeadline - Date.now();
    let quoteReference: string | undefined;
    const input = assistantQuoteInputSchema.parse(rawInput);
    const logQuoteEvent = (event: string, fields: Record<string, unknown>) => {
      if (!options.executionKey) return;
      console.info(
        JSON.stringify({
          event,
          execution_id: options.executionKey,
          ...(quoteReference ? { quote_reference: quoteReference } : {}),
          ...fields,
        }),
      );
    };
    const awaitExecution = <T>(
      start: () => Promise<T>,
      phase: string,
      timeoutMs = requestTimeoutMs,
    ): Promise<T> => {
      if (!executionMode) return start();
      const remaining = remainingExecutionMs();
      if (remaining <= 0) {
        logQuoteEvent("whatsapp_quote_request_timed_out", {
          phase,
          timeout_ms: 0,
          timeout_kind: "execution_budget",
        });
        throw new QuoteExecutionTimeoutError(phase, true);
      }
      const operation = start();
      const effectiveTimeout = Math.min(timeoutMs, remaining);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const deadlineExpired = remainingExecutionMs() <= 0;
          logQuoteEvent("whatsapp_quote_request_timed_out", {
            phase,
            timeout_ms: effectiveTimeout,
            timeout_kind: deadlineExpired ? "execution_budget" : "request",
          });
          reject(new QuoteExecutionTimeoutError(phase, deadlineExpired));
        }, effectiveTimeout);
      });
      return Promise.race([operation, timeout]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
    };
    const tenantId = await awaitExecution(
      () => this.ports.resolveStudioTenantId(),
      "tenant_resolution",
    );
    const collections = await awaitExecution(
      () => this.ports.listStudioCollectionsForTenant(tenantId, { all: true }),
      "collection_listing",
    );
    if (
      !["cotizaciones", "cotizaciones_detalle"].every((name) =>
        collections.data.some((c) => c.name === name),
      )
    )
      throw new Error("Quote collections are not installed or authorized");
    const form = await awaitExecution(
      () => this.getInsuranceQuoteFormForTenant(tenantId),
      "quote_settings",
    );
    if (
      options.expectedProductIds &&
      (form.products.length !== options.expectedProductIds.length ||
        form.products.some(
          (product, index) => product.id !== options.expectedProductIds![index],
        ))
    )
      throw new Error("Confirmed quote products changed");
    if (!form.products.length)
      throw new Error("No hay productos habilitados en el cotizador.");
    const reference = options.executionKey
      ? `COT-${options.executionKey}`
      : `COT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8)}`;
    quoteReference = reference;
    logQuoteEvent("whatsapp_quote_execution_started", {
      quote_reference: reference,
      enabled_products: form.products.length,
      concurrency: Math.min(4, form.products.length),
    });
    const base = this.ports.studioPath(tenantId, "records/");
    const write = <T>(path: string, method: string, body: unknown) => {
      const isProviderAction = path.includes(
        "extensions/insurance.quotes/actions/quote",
      );
      const phase = isProviderAction
        ? "provider_request"
        : method.toLowerCase() === "patch"
          ? "persistence_patch"
          : "persistence_post";
      if (executionMode && remainingExecutionMs() <= 0) {
        logQuoteEvent("whatsapp_quote_request_timed_out", {
          phase,
          timeout_ms: 0,
          timeout_kind: "execution_budget",
        });
        return Promise.reject(new QuoteExecutionTimeoutError(phase, true));
      }
      const controller = executionMode ? new AbortController() : undefined;
      const request = this.ports.request<T>(path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(options.executionKey && path.startsWith(base) && method === "POST"
            ? {
                "Idempotency-Key": `wa:${options.executionKey}:${String((body as Record<string, unknown>).name)}`,
              }
            : {}),
        },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!executionMode) return request;
      const remaining = remainingExecutionMs();
      if (remaining <= 0) {
        controller?.abort();
        request.catch(() => undefined);
        return Promise.reject(
          new QuoteExecutionTimeoutError("persistence", true),
        );
      }
      const timeoutMs = isProviderAction ? providerTimeoutMs : requestTimeoutMs;
      const effectiveTimeout = Math.min(timeoutMs, remaining);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const deadlineExpired = remainingExecutionMs() <= 0;
          controller?.abort();
          logQuoteEvent("whatsapp_quote_request_timed_out", {
            phase,
            timeout_ms: effectiveTimeout,
            timeout_kind: deadlineExpired ? "execution_budget" : "request",
          });
          reject(new QuoteExecutionTimeoutError(phase, deadlineExpired));
        }, effectiveTimeout);
      });
      return Promise.race([request, timeout]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
    };
    const master = await write<{ data: { id: string; _version: number } }>(
      base + "cotizaciones",
      "POST",
      {
        name: reference,
        ramo: "Automóviles",
        placa: input.vehicle.plate,
        valor_asegurado: input.vehicle.declaredValue,
        estado: "Solicitada",
      },
    );
    if (options.linkOwnership)
      await awaitExecution(
        () => options.linkOwnership!(master.data.id),
        "ownership_link",
      );
    const url = `/#/crm?tenantId=${tenantId}&object=cotizador_por_pasos&quote=${encode(master.data.id)}`;
    const outcomes: Array<{
      provider: string;
      product: string;
      premium?: number;
      quoteNumber?: string;
      failed: boolean;
      uncertain?: boolean;
    }> = [];
    const proposalByProduct = new Map<string, PublicQuoteProposal>(
      form.products.map((product) => [
        product.id,
        {
          id: product.id,
          provider: product.label.split(" · ")[0].slice(0, 100),
          product: product.label.slice(0, 150),
          state: "failed",
          currency: "COP",
        },
      ]),
    );
    const persistenceWarnings: string[] = [];
    let undispatchedOffers = 0;
    // A saved detail precedes every external call; failures never cause an automatic replay.
    const queue = [...form.products];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) {
          if (executionMode && remainingExecutionMs() <= 0) break;
          const product = queue.shift()!;
          const provider = product.label.split(" · ")[0];
          const productStartedAt = Date.now();
          let detail: { data: { id: string; _version: number } };
          try {
            detail = await write(base + "cotizaciones_detalle", "POST", {
              name: `${reference}-${product.id}`,
              cotizacion: master.data.id,
              aseguradora: provider,
              producto: product.label,
              flow_id: product.id,
              estado: "Solicitada",
            });
          } catch (error) {
            logQuoteEvent("whatsapp_quote_product_finished", {
              product_id: product.id,
              provider,
              outcome: "detail_persistence_failed",
              duration_ms: Date.now() - productStartedAt,
              error_type: error instanceof Error ? error.name : "unknown",
            });
            persistenceWarnings.push(
              `No se pudo preparar ${product.label}; no se envió al proveedor.`,
            );
            undispatchedOffers++;
            continue;
          }
          let dispatchClaimed = true;
          try {
            if (options.claimDispatch)
              dispatchClaimed = await awaitExecution(
                () => options.claimDispatch!(product.id),
                "dispatch_claim",
              );
          } catch {
            dispatchClaimed = false;
            logQuoteEvent("whatsapp_quote_product_finished", {
              product_id: product.id,
              provider,
              outcome: "dispatch_claim_unverified",
              duration_ms: Date.now() - productStartedAt,
            });
            persistenceWarnings.push(
              `No se pudo verificar el envío de ${product.label}; no se llamó al proveedor. Revisa el historial antes de repetir la solicitud.`,
            );
            undispatchedOffers++;
            continue;
          }
          if (!dispatchClaimed) {
            logQuoteEvent("whatsapp_quote_product_finished", {
              product_id: product.id,
              provider,
              outcome: "dispatch_already_claimed",
              duration_ms: Date.now() - productStartedAt,
            });
            outcomes.push({
              provider,
              product: product.label,
              failed: true,
              uncertain: true,
            });
            proposalByProduct.set(product.id, {
              ...proposalByProduct.get(product.id)!,
              state: "uncertain",
            });
            persistenceWarnings.push(
              `La solicitud de ${product.label} ya fue enviada; consulta su historial sin repetirla.`,
            );
            continue;
          }
          if (executionMode && remainingExecutionMs() <= 0) {
            logQuoteEvent("whatsapp_quote_request_timed_out", {
              phase: "provider_request",
              timeout_ms: 0,
              timeout_kind: "execution_budget",
            });
            persistenceWarnings.push(
              `No se llamó al proveedor para ${product.label} porque terminó el tiempo disponible; revisa el historial antes de repetir la solicitud.`,
            );
            undispatchedOffers++;
            continue;
          }
          let data: Record<string, unknown>;
          let productFailed = false;
          let productUncertain = false;
          let productHasPremium = false;
          let productPremium: number | undefined;
          let productQuoteNumber: string | undefined;
          let productFacts: PublicQuoteFact[] = [];
          const providerStartedAt = Date.now();
          try {
            const response = await write<{
              data: {
                run: { runId: string };
                output: { data?: Record<string, any> };
              };
            }>(
              this.ports.studioPath(
                tenantId,
                "extensions/insurance.quotes/actions/quote",
              ),
              "POST",
              {
                input: { mode: "live", flowId: product.id, quoteInput: input },
              },
            );
            const result = response.data.output?.data ?? {};
            const rawPremium =
              result.premiumTotal ??
              result.premium ??
              result.response?.datosEconomicos?.total ??
              result.response?.datosEconomicos?.primaAnual;
            const premium =
              (typeof rawPremium === "number" ||
                typeof rawPremium === "string") &&
              Number.isFinite(Number(rawPremium)) &&
              Number(rawPremium) > 0
                ? Number(rawPremium)
                : undefined;
            productHasPremium = premium !== undefined;
            productPremium = premium;
            const number =
              result.quoteNumber ?? result.response?.simulacion?.codigo;
            const quoteNumber =
              typeof number === "string" || typeof number === "number"
                ? String(number)
                : undefined;
            productQuoteNumber = quoteNumber;
            productFacts = providerCoverageFacts(result.coverages);
            outcomes.push({
              provider,
              product: product.label,
              premium,
              quoteNumber,
              failed: false,
            });
            proposalByProduct.set(product.id, {
              id: product.id,
              provider: provider.slice(0, 100),
              product: product.label.slice(0, 150),
              state: premium === undefined ? "unpriced" : "priced",
              ...(premium === undefined ? {} : { premium }),
              currency: "COP",
              ...(productFacts.length ? { facts: productFacts } : {}),
            });
            data = {
              estado: "Recibida",
              prima: premium,
              numero_cotizacion: quoteNumber,
              run_id: response.data.run.runId,
            };
            logQuoteEvent("whatsapp_quote_product_provider_finished", {
              product_id: product.id,
              provider,
              outcome: "response_received",
              duration_ms: Date.now() - providerStartedAt,
              premium_present: premium !== undefined,
              quote_number_present: quoteNumber !== undefined,
            });
          } catch (error) {
            productFailed = true;
            productUncertain = Boolean(options.executionKey);
            logQuoteEvent("whatsapp_quote_product_provider_finished", {
              product_id: product.id,
              provider,
              outcome: "request_failed_or_unverified",
              duration_ms: Date.now() - providerStartedAt,
              error_type: error instanceof Error ? error.name : "unknown",
            });
            outcomes.push({
              provider,
              product: product.label,
              failed: true,
              uncertain: Boolean(options.executionKey),
            });
            proposalByProduct.set(product.id, {
              ...proposalByProduct.get(product.id)!,
              state: productUncertain ? "uncertain" : "failed",
            });
            data = {
              estado: "Error",
              error_mensaje: "La aseguradora no pudo completar la cotización.",
            };
          }
          // Surface verified provider outcomes before a possibly slow history PATCH.
          if (options.onProgress) {
            try {
              const state = productUncertain
                ? "uncertain"
                : productFailed
                  ? "failed"
                  : productHasPremium
                    ? "priced"
                    : "unpriced";
              await awaitExecution(
                () =>
                  Promise.resolve(
                    options.onProgress!({
                      productId: product.id,
                      provider,
                      product: product.label,
                      ...(productPremium === undefined
                        ? {}
                        : { premium: productPremium }),
                      ...(productQuoteNumber === undefined
                        ? {}
                        : { quoteNumber: productQuoteNumber }),
                      ...(productFacts.length ? { facts: productFacts } : {}),
                      state,
                      reference,
                      quoteId: master.data.id,
                    }),
                  ),
                "progress_callback",
              );
            } catch (error) {
              logQuoteEvent("whatsapp_quote_progress_callback_failed", {
                product_id: product.id,
                provider,
                error_type: error instanceof Error ? error.name : "unknown",
              });
            }
          }
          try {
            await write(
              base + "cotizaciones_detalle/" + encode(detail.data.id),
              "PATCH",
              { ...data, _version: detail.data._version },
            );
          } catch (error) {
            logQuoteEvent("whatsapp_quote_product_history_update_failed", {
              product_id: product.id,
              provider,
              duration_ms: Date.now() - productStartedAt,
              error_type: error instanceof Error ? error.name : "unknown",
            });
            persistenceWarnings.push(
              `No se pudo actualizar el historial de ${product.label}. No repitas la solicitud automáticamente.`,
            );
          }
          logQuoteEvent("whatsapp_quote_product_finished", {
            product_id: product.id,
            provider,
            outcome: productUncertain
              ? "uncertain"
              : productFailed
                ? "failed"
                : !productHasPremium
                  ? "received_without_premium"
                  : "priced",
            duration_ms: Date.now() - productStartedAt,
          });
        }
      }),
    );
    undispatchedOffers += queue.length;
    if (queue.length) {
      persistenceWarnings.push(
        `${queue.length} producto(s) no se enviaron porque terminó el tiempo disponible para esta cotización.`,
      );
    }
    const priced = outcomes
      .filter((o) => !o.failed && o.premium !== undefined)
      .sort((a, b) => a.premium! - b.premium!);
    const lowestPremium = priced[0]?.premium ?? null;
    const lowest = priced.filter((o) => o.premium === lowestPremium);
    try {
      await write(base + "cotizaciones/" + encode(master.data.id), "PATCH", {
        _version: master.data._version,
        estado: outcomes.some((o) => !o.failed) ? "Recibida" : "Error",
        ...(lowestPremium === null ? {} : { prima: lowestPremium }),
      });
    } catch {
      persistenceWarnings.push(
        "No se pudo actualizar el estado de la cotización guardada.",
      );
    }
    const summary = {
      quoteId: master.data.id,
      reference,
      url,
      totalOffers: executionMode ? form.products.length : outcomes.length,
      ...(options.executionKey ? { undispatchedOffers } : {}),
      failedOffers: outcomes.filter((o) => o.failed && !o.uncertain).length,
      ...(options.executionKey
        ? { uncertainOffers: outcomes.filter((o) => o.uncertain).length }
        : {}),
      unpricedOffers: outcomes.filter(
        (o) => !o.failed && o.premium === undefined,
      ).length,
      pricedOffers: priced.length,
      lowestPremium,
      lowestPriceOffers: lowest.slice(0, 5),
      proposals: form.products.map((product) =>
        proposalByProduct.get(product.id)!,
      ),
      tiedOfferCount: lowest.length,
      coverageAvailable: false,
      persistenceWarnings,
      recommendation: lowest.length
        ? "Estas son las ofertas de menor precio recibidas. Para elegir el mejor equilibrio entre precio y cobertura faltan las coberturas y deducibles; no hay una ganadora integral verificada."
        : "No llegaron ofertas con prima válida. Revisa los resultados del cotizador antes de volver a consultar.",
    };
    logQuoteEvent("whatsapp_quote_execution_finished", {
      duration_ms: Date.now() - quoteStartedAt,
      total_products: summary.totalOffers,
      priced_products: summary.pricedOffers,
      failed_products: summary.failedOffers,
      uncertain_products: summary.uncertainOffers ?? 0,
      unpriced_products: summary.unpricedOffers,
      persistence_warning_count: summary.persistenceWarnings.length,
    });
    return summary;
  }

  async getQuoteSummary(reference?: string) {
    const tenantId = await this.ports.resolveStudioTenantId();
    const collections = await this.ports.listStudioCollectionsForTenant(
      tenantId,
      {
        all: true,
      },
    );
    if (
      !["cotizaciones", "cotizaciones_detalle"].every((name) =>
        collections.data.some((c) => c.name === name),
      )
    ) {
      throw new Error("Quote collections are not installed or authorized");
    }
    const params = new URLSearchParams({ page: "1", perPage: "1" });
    if (reference)
      params.set(
        "filters",
        JSON.stringify({
          logic: "and",
          conditions: [{ field: "name", op: "eq", value: reference }],
        }),
      );
    const masters = await this.ports.request<{
      data: Array<Record<string, unknown>>;
      total: number;
    }>(`${this.ports.studioPath(tenantId, "records/cotizaciones")}?${params}`);
    const totalQuotes =
      collections.data.find((c) => c.name === "cotizaciones")?.recordCount ??
      masters.total;
    const master = masters.data[0];
    if (!master) return { totalQuotes, quote: null, lowestPriceOffers: [] };
    const detailParams = new URLSearchParams({
      page: "1",
      perPage: "100",
      filters: JSON.stringify({
        logic: "or",
        conditions: [
          { field: "cotizacion", op: "eq", value: master.id },
          { field: "cotizacion", op: "eq", value: master.name },
        ],
      }),
    });
    const details = await this.ports.request<{
      data: Array<Record<string, unknown>>;
      total: number;
    }>(
      `${this.ports.studioPath(tenantId, "records/cotizaciones_detalle")}?${detailParams}`,
    );
    const received = details.data.filter((d) => d.estado === "Recibida");
    const priced = received
      .flatMap((d) => {
        const premium =
          typeof d.prima === "number" || typeof d.prima === "string"
            ? Number(d.prima)
            : NaN;
        return Number.isFinite(premium) && premium > 0
          ? [
              {
                provider: d.aseguradora,
                product: d.producto,
                quoteNumber: d.numero_cotizacion,
                premium,
              },
            ]
          : [];
      })
      .sort((a, b) => a.premium - b.premium);
    const lowestPremium = priced[0]?.premium ?? null;
    const lowest = priced.filter((p) => p.premium === lowestPremium);
    return {
      totalQuotes,
      selection: reference ? "requested_reference" : "most_recently_updated",
      quote: {
        reference: master.name,
        status: master.estado,
        insuredValue: master.valor_asegurado,
      },
      totalOffers: details.total,
      analyzedOffers: details.data.length,
      complete: details.data.length === details.total,
      failedOffers: details.data.filter((d) => d.estado === "Error").length,
      unpricedOffers: received.length - priced.length,
      pricedOffers: priced.length,
      lowestPremium,
      priceTie: lowest.length > 1,
      tiedOfferCount: lowest.length,
      lowestPriceOffers: lowest.slice(0, 5),
      coverageAvailable: false,
      recommendationBasis:
        "price_only; coverage and deductibles have not been returned by this summary. Do not infer a best overall policy or equate equal price with equal coverage.",
    };
  }
}
