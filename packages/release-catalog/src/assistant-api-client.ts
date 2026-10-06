import {
  InsuranceAssistantOperations,
  type InsuranceExecutionOptions,
} from "./assistant-operations";
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
    baseUrl: string,
    accessToken?: string,
    fetcher: typeof fetch = fetch,
    private readonly fixedTenantId?: number,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.accessToken = accessToken;
    this.fetcher = fetcher;
  }

  async listEmployees(): Promise<unknown> {
    return this.request("/api/assistant/mcp/employees");
  }

  async invokeEmployee(
    employeeId: string,
    message: string,
    history: Array<{ role: "user" | "assistant"; text: string }> = [],
  ): Promise<unknown> {
    return this.request(
      `/api/assistant/mcp/employees/${encode(employeeId)}/invoke`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
      },
    );
  }

  async employeeAction(
    actionId: string,
    operation: "confirm" | "cancel" | "status",
  ): Promise<unknown> {
    return this.request(
      `/api/assistant/actions/${encode(actionId)}${operation === "status" ? "" : `/${operation}`}`,
      { method: operation === "status" ? "GET" : "POST" },
    );
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

  async extensionStatus(id: string): Promise<SaviaExtensionStatus> {
    const tenantId = await this.resolveStudioTenantId();
    const response = await this.request<{ data: SaviaExtensionStatus[] }>(
      this.studioPath(tenantId, "extensions"),
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
    const tenantId = await this.resolveStudioTenantId();
    const response = await this.request<{ data: T }>(
      this.studioPath(tenantId, `extensions/${encode(id)}/summary`),
    );
    return response.data;
  }

  async listStoreMcpCatalog(): Promise<{
    data: Array<{
      pluginId: string;
      label: string;
      actions: Array<{
        id: string;
        kind: "simulation" | "http";
        method?: string;
        label: string;
        summary: string;
      }>;
    }>;
  }> {
    const tenantId = await this.resolveStudioTenantId();
    return this.request(this.studioPath(tenantId, "plugin-store/mcp-catalog"));
  }

  async executeStoreAction(
    pluginId: string,
    actionId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const tenantId = await this.resolveStudioTenantId();
    const response = await this.request<{ data: { output: unknown } }>(
      this.studioPath(
        tenantId,
        `extensions/${encode(pluginId)}/actions/${encode(actionId)}`,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      },
    );
    return response.data.output;
  }

  async listStudioCollections(options?: { all?: boolean } | boolean): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    const tenantId = await this.resolveStudioTenantId();
    return this.listStudioCollectionsForTenant(tenantId, options);
  }

  private async listStudioCollectionsForTenant(
    tenantId: number,
    options?: { all?: boolean } | boolean,
  ): Promise<{ data: Array<Record<string, unknown>> }> {
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
    }>(this.studioPath(tenantId, "objects"));
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
    tenantId: number,
    object: string,
    resource = "records",
    id?: string,
    allowAny = false,
  ): Promise<string> {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(object))
      throw new Error("Invalid Studio collection key");
    const collections = await this.listStudioCollectionsForTenant(tenantId, {
      all: allowAny,
    });
    if (!collections.data.some((collection) => collection.name === object)) {
      throw new Error("Collection is not an installed Studio collection");
    }
    if (id !== undefined && (!id.trim() || id === "." || id === ".."))
      throw new Error("Invalid Studio record identifier");
    return this.studioPath(
      tenantId,
      `${resource}/${encode(object)}${id === undefined ? "" : `/${encode(id)}`}`,
    );
  }

  async listStudioRecords(
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
    const tenantId = await this.resolveStudioTenantId();
    const isOptionsObject =
      typeof pageOrOptions === "object" && pageOrOptions !== null;
    const allowAny = isOptionsObject ? (pageOrOptions.allowAny ?? true) : false;
    const path = await this.crmPath(
      tenantId,
      object,
      "records",
      undefined,
      allowAny,
    );
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

  private insuranceOperations() {
    return new InsuranceAssistantOperations({
      request: (path, init) => this.request(path, init),
      resolveStudioTenantId: () => this.resolveStudioTenantId(),
      listStudioCollectionsForTenant: (tenant, options) =>
        this.listStudioCollectionsForTenant(tenant, options),
      studioPath: (tenant, path) => this.studioPath(tenant, path),
    });
  }
  lookupQuoteVehicle(plate: string) {
    return this.insuranceOperations().lookupQuoteVehicle(plate);
  }
  getInsuranceQuoteForm() {
    return this.insuranceOperations().getInsuranceQuoteForm();
  }
  createInsuranceQuote(input: unknown, options?: InsuranceExecutionOptions) {
    return this.insuranceOperations().createInsuranceQuote(input, options);
  }
  getQuoteSummary(reference?: string) {
    return this.insuranceOperations().getQuoteSummary(reference);
  }

  async aggregateStudioRecords(
    object: string,
    options: {
      groupBy?: string;
      amountField?: string;
      filters?: unknown;
    } = {},
  ): Promise<unknown> {
    const tenantId = await this.resolveStudioTenantId();
    const path = await this.crmPath(
      tenantId,
      object,
      "records",
      undefined,
      true,
    );
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

  async getStudioRecord(
    object: string,
    id: string,
    allowAny = false,
  ): Promise<unknown> {
    const tenantId = await this.resolveStudioTenantId();
    return this.request(
      await this.crmPath(tenantId, object, "records", id, allowAny),
    );
  }

  async createStudioRecord(
    object: string,
    data: Record<string, unknown>,
    allowAny = false,
  ): Promise<unknown> {
    const tenantId = await this.resolveStudioTenantId();
    return this.request(
      await this.crmPath(tenantId, object, "records", undefined, allowAny),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  }

  async updateStudioRecord(
    object: string,
    id: string,
    data: Record<string, unknown>,
    allowAny = false,
  ): Promise<unknown> {
    const tenantId = await this.resolveStudioTenantId();
    const payload = { ...data };
    if (
      payload._version === undefined ||
      !Number.isInteger(payload._version) ||
      Number(payload._version) < 1
    ) {
      try {
        const existing = (await this.request(
          await this.crmPath(tenantId, object, "records", id, allowAny),
        )) as {
          data?: { _version?: number };
          _version?: number;
        };
        payload._version = existing?.data?._version ?? existing?._version ?? 1;
      } catch {
        payload._version = 1;
      }
    }
    return this.request(
      await this.crmPath(tenantId, object, "records", id, allowAny),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  }

  async deleteStudioRecord(
    object: string,
    id: string,
    version?: number,
    allowAny = false,
  ): Promise<unknown> {
    const tenantId = await this.resolveStudioTenantId();
    let resolvedVersion = version;
    if (
      resolvedVersion === undefined ||
      !Number.isInteger(resolvedVersion) ||
      resolvedVersion < 1
    ) {
      try {
        const existing = (await this.request(
          await this.crmPath(tenantId, object, "records", id, allowAny),
        )) as {
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
      (await this.crmPath(tenantId, object, "records", id, allowAny)) + query,
      {
        method: "DELETE",
      },
    );
  }

  async getStudioRecordLinks(
    object: string,
    id: string,
    allowAny = true,
  ): Promise<unknown> {
    const tenantId = await this.resolveStudioTenantId();
    return this.request(
      await this.crmPath(tenantId, object, "record-links", id, allowAny),
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

  private async resolveStudioTenantId(): Promise<number> {
    if (this.fixedTenantId !== undefined) return this.fixedTenantId;
    const active = await this.request<{
      activeTenantId?: number;
      tenants: Array<{ id: number; name: string }>;
    }>("/v1/assistant/active-tenant");
    if (active.activeTenantId === undefined) return 0;
    if (
      !Number.isSafeInteger(active.activeTenantId) ||
      active.activeTenantId < 0
    )
      throw new Error("Active tenant resolution returned an invalid tenant id");
    return active.activeTenantId;
  }

  private studioPath(tenantId: number, path: string): string {
    return `/v1/studio/${tenantId}/api/${path}`;
  }
}
