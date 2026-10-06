import {
  assistantQuoteInputSchema,
  assistantQuoteForm,
} from "./assistant-contract";
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
export type InsuranceExecutionOptions = {
  executionKey?: string;
  linkOwnership?(quoteId: string): Promise<void>;
  claimDispatch?(productId: string): Promise<boolean>;
};
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
    const input = assistantQuoteInputSchema.parse(rawInput);
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
    )
      throw new Error("Quote collections are not installed or authorized");
    const form = await this.getInsuranceQuoteFormForTenant(tenantId);
    if (!form.products.length)
      throw new Error("No hay productos habilitados en el cotizador.");
    const reference = options.executionKey
      ? `COT-${options.executionKey}`
      : `COT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8)}`;
    const base = this.ports.studioPath(tenantId, "records/");
    const write = <T>(path: string, method: string, body: unknown) =>
      this.ports.request<T>(path, {
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
      });
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
    await options.linkOwnership?.(master.data.id);
    const url = `/#/crm?tenantId=${tenantId}&object=cotizador_por_pasos&quote=${encode(master.data.id)}`;
    const outcomes: Array<{
      provider: string;
      product: string;
      premium?: number;
      quoteNumber?: string;
      failed: boolean;
      uncertain?: boolean;
    }> = [];
    const persistenceWarnings: string[] = [];
    // A saved detail precedes every external call; failures never cause an automatic replay.
    const queue = [...form.products];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) {
          const product = queue.shift()!;
          const provider = product.label.split(" · ")[0];
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
          } catch {
            persistenceWarnings.push(
              `No se pudo preparar ${product.label}; no se envió al proveedor.`,
            );
            continue;
          }
          if (
            options.claimDispatch &&
            !(await options.claimDispatch(product.id))
          ) {
            outcomes.push({
              provider,
              product: product.label,
              failed: true,
              uncertain: true,
            });
            persistenceWarnings.push(
              `La solicitud de ${product.label} ya fue enviada; consulta su historial sin repetirla.`,
            );
            continue;
          }
          let data: Record<string, unknown>;
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
            const number =
              result.quoteNumber ?? result.response?.simulacion?.codigo;
            const quoteNumber =
              typeof number === "string" || typeof number === "number"
                ? String(number)
                : undefined;
            outcomes.push({
              provider,
              product: product.label,
              premium,
              quoteNumber,
              failed: false,
            });
            data = {
              estado: "Recibida",
              prima: premium,
              numero_cotizacion: quoteNumber,
              run_id: response.data.run.runId,
            };
          } catch {
            outcomes.push({
              provider,
              product: product.label,
              failed: true,
              uncertain: Boolean(options.executionKey),
            });
            data = {
              estado: "Error",
              error_mensaje: "La aseguradora no pudo completar la cotización.",
            };
          }
          try {
            await write(
              base + "cotizaciones_detalle/" + encode(detail.data.id),
              "PATCH",
              { ...data, _version: detail.data._version },
            );
          } catch {
            persistenceWarnings.push(
              `No se pudo actualizar el historial de ${product.label}. No repitas la solicitud automáticamente.`,
            );
          }
        }
      }),
    );
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
    return {
      quoteId: master.data.id,
      reference,
      url,
      totalOffers: form.products.length,
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
      tiedOfferCount: lowest.length,
      coverageAvailable: false,
      persistenceWarnings,
      recommendation: lowest.length
        ? "Estas son las ofertas de menor precio recibidas. Para elegir el mejor equilibrio entre precio y cobertura faltan las coberturas y deducibles; no hay una ganadora integral verificada."
        : "No llegaron ofertas con prima válida. Revisa los resultados del cotizador antes de volver a consultar.",
    };
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
