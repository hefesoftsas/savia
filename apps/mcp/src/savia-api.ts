import {
  assistantQuoteInputSchema,
  assistantQuoteForm,
} from "@savia/release-catalog/assistant-contracts";
export type SaviaDocument = {
  id: string;
  kind: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, unknown>;
};

export type SaviaDomain = {
  id: string;
  collections: Array<{
    domain: string;
    collection: string;
    title: string;
    description: string;
  }>;
  commands: Array<{
    domain: string;
    command: string;
    title: string;
    description: string;
    input: Array<{
      name: string;
      type: string;
      required: boolean;
      description: string;
    }>;
  }>;
};

export type PersonalFileProvider =
  "google_drive" | "onedrive_personal" | "onedrive_business";
export type PersonalMessageProvider = "gmail" | "outlook";
export type PersonalEventProvider = "google_calendar" | "outlook";

export type PersonalFile = {
  id: string;
  name: string;
  mimeType: string | null;
  modifiedAt: string | null;
};

export type PersonalMessage = {
  id: string;
  subject: string | null;
  sender: string | null;
  receivedAt: string | null;
};

export type PersonalEvent = {
  id: string;
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type CrmSyncJob = {
  id: string;
  ruleId: string;
  customerId: number;
  provider: string;
  status: "pending" | "processing" | "synced" | "failed" | "blocked";
  attempts: number;
  lastError: string | null;
  updatedAt: string;
  externalUrl: string | null;
};

export type SaviaExtensionStatus = {
  manifest: {
    id: string;
    version: string;
    label: string;
    description: string;
    requires: string[];
    apiVersion: 1;
  };
  builtIn: boolean;
  installed: { version: string; enabled: boolean } | null;
};

type ErrorResponse = { error?: { code?: string; message?: string } };

function encode(value: string): string {
  return encodeURIComponent(value);
}

export class SaviaApiClient {
  private readonly baseUrl: string;
  private readonly accessToken: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(
    baseUrl = process.env.SAVIA_API_URL ?? "http://127.0.0.1:8787",
    accessToken = process.env.SAVIA_API_TOKEN,
    fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.accessToken = accessToken;
    this.fetcher = fetcher;
  }

  async listDomains(): Promise<SaviaDomain[]> {
    const response = await this.request<{ data: SaviaDomain[] }>("/v1/domains");
    return response.data;
  }

  async listDocuments(
    domain: string,
    collection: string,
    limit = 20,
    offset = 0,
  ): Promise<{
    data: SaviaDocument[];
    page: { limit: number; offset: number; total?: number };
  }> {
    return this.request(
      `/v1/${encode(domain)}/${encode(collection)}?limit=${limit}&offset=${offset}`,
    );
  }

  async getDocument(
    domain: string,
    collection: string,
    id: string,
  ): Promise<SaviaDocument> {
    return this.request(
      `/v1/${encode(domain)}/${encode(collection)}/${encode(id)}`,
    );
  }

  async executeCommand(
    domain: string,
    command: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (domain === "insurance" && command === "quote-auto")
      return this.createInsuranceQuote(input);
    return this.request(`/v1/${encode(domain)}/commands/${encode(command)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  async searchPersonalFiles(
    provider: PersonalFileProvider,
    query: string,
  ): Promise<{ data: PersonalFile[] }> {
    return this.request(
      `/v1/personal-integrations/files?${new URLSearchParams({
        provider,
        query,
      }).toString()}`,
    );
  }

  async searchPersonalMessages(
    provider: PersonalMessageProvider,
    query: string,
  ): Promise<{ data: PersonalMessage[] }> {
    return this.request(
      `/v1/personal-integrations/messages?${new URLSearchParams({
        provider,
        query,
      }).toString()}`,
    );
  }

  async listPersonalEvents(
    provider: PersonalEventProvider,
  ): Promise<{ data: PersonalEvent[] }> {
    return this.request(
      `/v1/personal-integrations/events?${new URLSearchParams({
        provider,
      }).toString()}`,
    );
  }

  async executePersonalAction(
    actionId: string,
  ): Promise<{ data: { provider: string; action: string } }> {
    return this.request(
      `/v1/personal-integrations/actions/${encode(actionId)}/execute`,
      { method: "POST" },
    );
  }

  getCrmSyncStatus(customerId?: number): Promise<{ data: CrmSyncJob[] }> {
    const query =
      customerId === undefined
        ? ""
        : `?customerId=${encode(String(customerId))}`;
    return this.request(`/v1/crm/sync-jobs${query}`);
  }

  async extensionStatus(id: string): Promise<SaviaExtensionStatus> {
    const response = await this.request<{ data: SaviaExtensionStatus[] }>(
      "/v1/data-domains/platform/api/extensions",
    );
    const extension = response.data.find(
      (candidate) => candidate.manifest.id === id,
    );
    if (!extension) {
      throw new Error("Extension is not included in this Savia release");
    }
    return extension;
  }

  async getExtensionSummary<T = unknown>(id: string): Promise<T> {
    const response = await this.request<{ data: T }>(
      `/v1/data-domains/platform/api/extensions/${encode(id)}/summary`,
    );
    return response.data;
  }

  async listCrmCollections(options?: { all?: boolean } | boolean): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    const all = typeof options === "boolean" ? options : Boolean(options?.all);
    const result = await this.request<{
      data: Array<
        Record<string, unknown> & {
          name?: string;
          label?: string;
          description?: string;
          count?: number;
          config?: {
            fields?: Record<string, unknown>;
            studio?: {
              collection?: { kind?: string };
              screen?: { hidden?: boolean };
              requestPage?: unknown;
            };
          };
        }
      >;
    }>("/v1/data-domains/platform/api/objects");
    if (!all) {
      return {
        data: result.data.filter(
          (object) => object.config?.studio?.collection?.kind === "crm",
        ),
      };
    }
    return {
      // Menu visibility is not a data permission; the API scopes objects to the caller.
      data: result.data.map((object) => {
        const fields: Array<{
          name: string;
          label: string;
          type: string;
          required?: boolean;
          options?: string[];
          description?: string;
        }> = [];
        if (object.config?.fields && typeof object.config.fields === "object") {
          for (const [key, field] of Object.entries(object.config.fields)) {
            if (field && typeof field === "object") {
              const f = field as Record<string, unknown>;
              if (f.hidden) continue;
              fields.push({
                name: key,
                label: typeof f.label === "string" ? f.label : key,
                type:
                  f.type === "Number"
                    ? "number"
                    : f.type === "Toggle"
                      ? "boolean"
                      : f.type === "DateControl"
                        ? "date"
                        : f.type === "Dropdown"
                          ? "dropdown"
                          : "string",
                required: Boolean(f.required),
                options: Array.isArray(f.options)
                  ? f.options.map((o: unknown) =>
                      typeof o === "string"
                        ? o
                        : typeof o === "object" && o !== null && "value" in o
                          ? String((o as { value: unknown }).value)
                          : String(o),
                    )
                  : undefined,
                description:
                  typeof f.description === "string" ? f.description : undefined,
              });
            }
          }
        }
        return {
          name: object.name ?? "",
          label: object.label ?? object.name ?? "",
          description: object.description ?? "",
          recordCount: object.count,
          kind:
            object.config?.studio?.collection?.kind ??
            (object.config?.studio?.requestPage ? "request_page" : "local"),
          fields,
        };
      }),
    };
  }

  private async crmPath(
    object: string,
    resource = "records",
    id?: string,
    allowAny = false,
  ): Promise<string> {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(object))
      throw new Error("Invalid CRM collection key");
    const collections = await this.listCrmCollections({ all: allowAny });
    if (!collections.data.some((collection) => collection.name === object)) {
      throw new Error("Collection is not an installed CRM collection");
    }
    if (id !== undefined && (!id.trim() || id === "." || id === ".."))
      throw new Error("Invalid CRM record identifier");
    return `/v1/data-domains/platform/api/${resource}/${encode(object)}${id === undefined ? "" : `/${encode(id)}`}`;
  }

  async listCrmRecords(
    object: string,
    pageOrOptions?:
      | number
      | {
          page?: number;
          perPage?: number;
          query?: string;
          sort?: string;
          order?: "ASC" | "DESC";
          filters?: unknown;
          allowAny?: boolean;
        },
    perPage = 25,
    query?: string,
  ): Promise<unknown> {
    const isOptionsObject =
      typeof pageOrOptions === "object" && pageOrOptions !== null;
    const allowAny = isOptionsObject ? (pageOrOptions.allowAny ?? true) : false;
    const path = await this.crmPath(object, "records", undefined, allowAny);
    let page = 1;
    let actualPerPage = perPage;
    let actualQuery = query;
    let sort: string | undefined;
    let order: "ASC" | "DESC" | undefined;
    let filters: unknown | undefined;

    if (isOptionsObject) {
      page = pageOrOptions.page ?? 1;
      actualPerPage = pageOrOptions.perPage ?? 25;
      actualQuery = pageOrOptions.query;
      sort = pageOrOptions.sort;
      order = pageOrOptions.order;
      filters = pageOrOptions.filters;
    } else if (typeof pageOrOptions === "number") {
      page = pageOrOptions;
    }

    const params = new URLSearchParams({
      page: String(page),
      perPage: String(actualPerPage),
    });
    if (actualQuery !== undefined) params.set("q", actualQuery);
    if (sort !== undefined) params.set("sort", sort);
    if (order !== undefined) params.set("order", order);
    if (filters !== undefined) {
      params.set(
        "filters",
        typeof filters === "string" ? filters : JSON.stringify(filters),
      );
    }
    return this.request(`${path}?${params}`);
  }

  async lookupDaneCity(city: string, department?: string) {
    if (
      city.trim().length < 2 ||
      city.length > 100 ||
      (department?.length ?? 0) > 100
    )
      throw new Error("Indica una ciudad válida.");
    const params = new URLSearchParams({ city: city.trim() });
    if (department?.trim()) params.set("department", department.trim());
    return this.request(`/v1/savia-request/api/lookups/dane?${params}`);
  }

  async lookupQuoteVehicle(plate: string) {
    const normalized = plate.trim().toUpperCase();
    if (!/^[A-Z0-9]{5,8}$/.test(normalized))
      throw new Error("Indica una placa válida.");
    const settings = await this.request<{
      data: { value: { vehicleLookup: { enabled: boolean; flowId: string } } };
    }>("/v1/data-domains/platform/api/extensions/insurance.quotes/settings");
    const lookup = settings.data.value.vehicleLookup;
    if (!lookup?.enabled)
      throw new Error("La consulta de placa no está habilitada.");
    if (lookup.flowId !== "sura-autos-provider")
      throw new Error(
        "La consulta de placa configurada aún no está disponible para el asistente.",
      );
    const response = await this.request<{
      data: { output: { data?: { vehicle?: Record<string, unknown> } } };
    }>(
      "/v1/data-domains/platform/api/extensions/insurance.quotes/actions/quote",
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
    const settings = await this.request<{
      data: {
        value: {
          products: Array<{ id: string; label: string; enabled: boolean }>;
        };
      };
    }>("/v1/data-domains/platform/api/extensions/insurance.quotes/settings");
    return {
      ...assistantQuoteForm,
      products: settings.data.value.products
        .filter((p) => p.enabled)
        .map((p) => ({ id: p.id, label: p.label })),
    };
  }

  async createInsuranceQuote(rawInput: unknown) {
    const input = assistantQuoteInputSchema.parse(rawInput);
    const collections = await this.listCrmCollections({ all: true });
    if (
      !["cotizaciones", "cotizaciones_detalle"].every((name) =>
        collections.data.some((c) => c.name === name),
      )
    )
      throw new Error("Quote collections are not installed or authorized");
    const form = await this.getInsuranceQuoteForm();
    if (!form.products.length)
      throw new Error("No hay productos habilitados en el cotizador.");
    const reference = `COT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8)}`;
    const base = "/v1/data-domains/platform/api/records/";
    const write = <T>(path: string, method: string, body: unknown) =>
      this.request<T>(path, {
        method,
        headers: { "content-type": "application/json" },
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
    const url = `/#/crm?domain=platform&object=cotizador_por_pasos&quote=${encode(master.data.id)}`;
    const outcomes: Array<{
      provider: string;
      product: string;
      premium?: number;
      quoteNumber?: string;
      failed: boolean;
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
          let data: Record<string, unknown>;
          try {
            const response = await write<{
              data: {
                run: { runId: string };
                output: { data?: Record<string, any> };
              };
            }>(
              "/v1/data-domains/platform/api/extensions/insurance.quotes/actions/quote",
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
            outcomes.push({ provider, product: product.label, failed: true });
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
      failedOffers: outcomes.filter((o) => o.failed).length,
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
    const collections = await this.listCrmCollections({ all: true });
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
    const masters = await this.request<{
      data: Array<Record<string, unknown>>;
      total: number;
    }>(`/v1/data-domains/platform/api/records/cotizaciones?${params}`);
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
    const details = await this.request<{
      data: Array<Record<string, unknown>>;
      total: number;
    }>(
      `/v1/data-domains/platform/api/records/cotizaciones_detalle?${detailParams}`,
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

  async aggregateCrmRecords(
    object: string,
    options: {
      groupBy?: string;
      amountField?: string;
      filters?: unknown;
    } = {},
  ): Promise<unknown> {
    const path = await this.crmPath(object, "records", undefined, true);
    if (!options.groupBy) {
      const params = new URLSearchParams({ page: "1", perPage: "1" });
      if (options.filters !== undefined) {
        params.set(
          "filters",
          typeof options.filters === "string"
            ? options.filters
            : JSON.stringify(options.filters),
        );
      }
      const response = await this.request<{ total: number }>(
        `${path}?${params}`,
      );
      return { total: response.total ?? 0 };
    }
    const params = new URLSearchParams({ group: options.groupBy });
    if (options.amountField !== undefined) {
      params.set("amountField", options.amountField);
    }
    if (options.filters !== undefined) {
      params.set(
        "filters",
        typeof options.filters === "string"
          ? options.filters
          : JSON.stringify(options.filters),
      );
    }
    return this.request(`${path}/summary?${params}`);
  }

  async getCrmRecord(
    object: string,
    id: string,
    allowAny = false,
  ): Promise<unknown> {
    return this.request(await this.crmPath(object, "records", id, allowAny));
  }

  async createCrmRecord(
    object: string,
    data: Record<string, unknown>,
    allowAny = false,
  ): Promise<unknown> {
    return this.request(
      await this.crmPath(object, "records", undefined, allowAny),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  }

  async updateCrmRecord(
    object: string,
    id: string,
    data: Record<string, unknown>,
    allowAny = false,
  ): Promise<unknown> {
    const payload = { ...data };
    if (
      payload._version === undefined ||
      !Number.isInteger(payload._version) ||
      Number(payload._version) < 1
    ) {
      try {
        const existing = (await this.getCrmRecord(object, id, allowAny)) as {
          data?: { _version?: number };
          _version?: number;
        };
        payload._version = existing?.data?._version ?? existing?._version ?? 1;
      } catch {
        payload._version = 1;
      }
    }
    return this.request(await this.crmPath(object, "records", id, allowAny), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async deleteCrmRecord(
    object: string,
    id: string,
    version?: number,
    allowAny = false,
  ): Promise<unknown> {
    let resolvedVersion = version;
    if (
      resolvedVersion === undefined ||
      !Number.isInteger(resolvedVersion) ||
      resolvedVersion < 1
    ) {
      try {
        const existing = (await this.getCrmRecord(object, id, allowAny)) as {
          data?: { _version?: number };
          _version?: number;
        };
        resolvedVersion = existing?.data?._version ?? existing?._version ?? 1;
      } catch {
        resolvedVersion = 1;
      }
    }
    const query = `?version=${encodeURIComponent(resolvedVersion)}`;
    return this.request(
      (await this.crmPath(object, "records", id, allowAny)) + query,
      {
        method: "DELETE",
      },
    );
  }

  async getCrmRecordLinks(
    object: string,
    id: string,
    allowAny = true,
  ): Promise<unknown> {
    return this.request(
      await this.crmPath(object, "record-links", id, allowAny),
    );
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (this.accessToken && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${this.accessToken}`);
    }
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (response.ok) return (await response.json()) as T;

    const error = (await response.json().catch(() => ({}))) as ErrorResponse;
    const code = error.error?.code ?? "API_ERROR";
    const message = error.error?.message ?? "Domain API request failed";
    throw new Error(`${response.status} ${code}: ${message}`);
  }
}
