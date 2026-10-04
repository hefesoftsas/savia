import type {
  NangoClient,
  NangoConnectionSummary,
  NangoProxyRequest,
} from "./contracts";
import {
  CrmUnavailableError,
  CrmUpstreamError,
  requireCrmProviderId,
} from "./contracts";

export type NangoConfiguration = {
  baseUrl?: string;
  connectUrl?: string;
  apiKey?: string;
  hubspotIntegrationId?: string;
  salesforceIntegrationId?: string;
  zohoIntegrationId?: string;
  pipedriveIntegrationId?: string;
  googleDriveIntegrationId?: string;
  gmailIntegrationId?: string;
  googleCalendarIntegrationId?: string;
  outlookIntegrationId?: string;
  oneDrivePersonalIntegrationId?: string;
  oneDriveBusinessIntegrationId?: string;
  jiraIntegrationId?: string;
  jiraReportingConnectionId?: string;
  linearIntegrationId?: string;
  githubIntegrationId?: string;
  zoomIntegrationId?: string;
};

type ConfiguredNango = {
  baseUrl: string;
  connectUrl: string;
  apiKey: string;
  integrationIds: Partial<
    Record<"hubspot" | "salesforce" | "zoho" | "pipedrive", string>
  >;
};

function normalizedUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function configuredNango(
  configuration: NangoConfiguration,
): Omit<ConfiguredNango, "integrationIds"> {
  const baseUrl = normalizedUrl(configuration.baseUrl);
  const apiKey = configuredValue(configuration.apiKey);
  if (!baseUrl || !apiKey) throw new CrmUnavailableError();
  return {
    baseUrl,
    connectUrl: normalizedUrl(configuration.connectUrl) ?? baseUrl,
    apiKey,
  };
}

function configuredIntegrationIds(
  configuration: NangoConfiguration,
): ConfiguredNango["integrationIds"] {
  return {
    hubspot: configuredValue(configuration.hubspotIntegrationId),
    salesforce: configuredValue(configuration.salesforceIntegrationId),
    zoho: configuredValue(configuration.zohoIntegrationId),
    pipedrive: configuredValue(configuration.pipedriveIntegrationId),
  };
}

function requireConfiguredNango(
  configuration: NangoConfiguration,
): ConfiguredNango {
  return {
    ...configuredNango(configuration),
    integrationIds: configuredIntegrationIds(configuration),
  };
}

function integrationIdFor(
  configuration: NangoConfiguration,
  provider: keyof ConfiguredNango["integrationIds"],
): string {
  const id = configuredIntegrationIds(configuration)[provider];
  if (!id) throw new CrmUnavailableError();
  return id;
}

function nangoUrl(baseUrl: string, path: string): URL {
  return new URL(`${baseUrl}${path}`);
}

function authorizationHeaders(apiKey: string): Headers {
  return new Headers({ authorization: `Bearer ${apiKey}` });
}

function safeMetadata(value: unknown): Record<string, string | string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, string | string[]> = {};
  for (const key of [
    "scopes",
    "scope",
    "portal_id",
    "portal_name",
    "account_name",
  ]) {
    const item = source[key];
    if (typeof item === "string") result[key] = item;
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string"))
      result[key] = item;
  }
  return result;
}

function safeConnectionConfig(
  value: unknown,
): NangoConnectionSummary["connectionConfig"] {
  const source = recordFrom(value);
  if (!source) return undefined;
  const result: NonNullable<NangoConnectionSummary["connectionConfig"]> = {};
  const instanceUrl = readString(source.instance_url);
  const apiDomain = readString(source.api_domain);
  const extension = readString(source.extension);
  if (instanceUrl) result.instanceUrl = instanceUrl;
  if (apiDomain) result.apiDomain = apiDomain;
  if (
    extension &&
    ["com", "eu", "in", "com.au", "com.cn", "jp"].includes(extension)
  )
    result.extension = extension;
  return Object.keys(result).length ? result : undefined;
}

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeScopes(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    if (!value.every((entry) => typeof entry === "string")) return undefined;
    return value.map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value === "string")
    return value
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  return undefined;
}

function scopeSummary(
  data: Record<string, unknown>,
): Pick<NangoConnectionSummary, "scopes" | "scopeSource"> {
  const credentials = recordFrom(data.credentials);
  const rawCredentials = recordFrom(credentials?.raw);
  const credentialScopes = safeScopes(
    rawCredentials?.scopes ??
      rawCredentials?.scope ??
      credentials?.scopes ??
      credentials?.scope,
  );
  if (credentialScopes !== undefined)
    return { scopes: credentialScopes, scopeSource: "credentials.raw" };

  const metadata = recordFrom(data.metadata);
  const metadataScopes = safeScopes(metadata?.scopes ?? metadata?.scope);
  if (metadataScopes !== undefined)
    return { scopes: metadataScopes, scopeSource: "metadata" };

  const directScopes = safeScopes(data.scopes ?? data.scope);
  if (directScopes !== undefined)
    return { scopes: directScopes, scopeSource: "metadata" };

  return { scopes: [], scopeSource: "none" };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function allowedHubSpotProxyPath(path: string): boolean {
  let url: URL;
  try {
    url = new URL(path, "https://savia.invalid");
  } catch {
    return false;
  }
  if (url.origin !== "https://savia.invalid") return false;
  if (url.pathname === "/account-info/v3/details") return !url.search;
  if (url.pathname === "/crm/v3/owners") return true;
  const objectPaths = [
    "contacts",
    "companies",
    "deals",
    "tickets",
    "products",
    "line_items",
    "quotes",
    "tasks",
    "notes",
    "meetings",
    "calls",
    "emails",
  ];
  const associationLabels =
    /^\/crm\/v4\/associations\/([^/]+)\/([^/]+)\/labels$/.exec(url.pathname);
  if (associationLabels)
    return (
      objectPaths.includes(associationLabels[1]) &&
      objectPaths.includes(associationLabels[2])
    );
  const associationWrite =
    /^\/crm\/v4\/objects\/([^/]+)\/\d+\/associations\/(?:default\/)?([^/]+)\/\d+$/.exec(
      url.pathname,
    );
  if (associationWrite)
    return (
      objectPaths.includes(associationWrite[1]) &&
      objectPaths.includes(associationWrite[2])
    );
  if (
    objectPaths.some(
      (object) =>
        url.pathname === `/crm/v3/properties/${object}` ||
        url.pathname === `/crm/v3/pipelines/${object}` ||
        url.pathname === `/crm/v3/objects/${object}/batch/read`,
    )
  )
    return true;
  if (
    /^\/crm\/v3\/objects\/[^/]+\/\d+\/associations\/[^/]+$/.test(url.pathname)
  ) {
    const parts = url.pathname.split("/");
    return objectPaths.includes(parts[4]) && objectPaths.includes(parts[7]);
  }
  if (
    /^\/crm\/v3\/associations\/[^/]+\/[^/]+\/batch\/create$/.test(url.pathname)
  ) {
    const parts = url.pathname.split("/");
    return objectPaths.includes(parts[4]) && objectPaths.includes(parts[5]);
  }
  return objectPaths.some(
    (object) =>
      url.pathname === `/crm/v3/objects/${object}` ||
      url.pathname === `/crm/v3/objects/${object}/search` ||
      new RegExp(`^/crm/v3/objects/${object}/[^/]+$`).test(url.pathname),
  );
}

function allowedNativeProxyRequest(request: NangoProxyRequest): boolean {
  let url: URL;
  try {
    url = new URL(request.path, "https://savia.invalid");
  } catch {
    return false;
  }
  if (url.origin !== "https://savia.invalid" || !url.pathname.startsWith("/"))
    return false;
  const path = url.pathname;
  if (request.connection.provider === "salesforce") {
    const root = /^\/services\/data\/v\d+(?:\.\d+)?\//.test(path);
    if (!root) return false;
    if (/^\/services\/data\/v\d+(?:\.\d+)?\/query$/.test(path))
      return request.method === "GET";
    const resource =
      /^\/services\/data\/v\d+(?:\.\d+)?\/sobjects\/(Contact|Account|Opportunity)(?:\/([^/]+))?$/.exec(
        path,
      );
    if (!resource) return false;
    const [, , id] = resource;
    if (!id) return ["GET", "POST"].includes(request.method);
    if (id === "describe") return request.method === "GET";
    if (!/^(?:[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(id)) return false;
    return ["GET", "PATCH"].includes(request.method);
  }
  if (request.connection.provider === "zoho") {
    if (/^\/crm\/v\d+\/org$/.test(path)) return request.method === "GET";
    if (/^\/crm\/v\d+\/settings\/modules$/.test(path))
      return request.method === "GET";
    const search = /^\/crm\/v\d+\/(Contacts|Accounts|Deals)\/search$/.exec(
      path,
    );
    if (search) return request.method === "GET";
    const collection =
      /^\/crm\/v\d+\/(Contacts|Accounts|Deals)(?:\/([^/]+))?$/.exec(path);
    if (collection) {
      const [, , id] = collection;
      if (!id) return ["GET", "POST", "PUT"].includes(request.method);
      return /^[0-9]+$/.test(id) && ["GET", "PUT"].includes(request.method);
    }
    return (
      /^\/crm\/v\d+\/settings\/fields$/.test(path) && request.method === "GET"
    );
  }
  if (request.connection.provider === "pipedrive") {
    if (path === "/v1/users/me") return request.method === "GET";
    if (
      /^\/v1\/(?:organizations\/[0-9]+\/(?:persons|deals)|persons\/[0-9]+\/deals)$/.test(
        path,
      )
    )
      return request.method === "GET";
    const search = /^\/v1\/(persons|organizations|deals)\/search$/.exec(path);
    if (search) return request.method === "GET";
    const endpoint = /^\/v1\/(persons|organizations|deals)(?:\/([^/]+))?$/.exec(
      path,
    );
    if (endpoint) {
      const [, , id] = endpoint;
      if (!id) return ["GET", "POST"].includes(request.method);
      return (
        /^[0-9]+$/.test(id) && ["GET", "PUT", "PATCH"].includes(request.method)
      );
    }
    return (
      /^\/v1\/(personFields|organizationFields|dealFields)$/.test(path) &&
      request.method === "GET"
    );
  }
  return false;
}

function proxyHeaders(apiKey: string, request: NangoProxyRequest): Headers {
  const headers = authorizationHeaders(apiKey);
  headers.set("connection-id", request.connection.nangoConnectionId);
  headers.set("provider-config-key", request.connection.nangoIntegrationId);
  if (request.body !== undefined)
    headers.set("content-type", "application/json");
  return headers;
}

export function createNangoClient(
  configuration: NangoConfiguration,
  fetcher: typeof fetch = fetch,
): NangoClient {
  return {
    async createConnectSession({ actor, agencyId, provider }) {
      requireCrmProviderId(provider);
      const nango = requireConfiguredNango(configuration);
      const integrationId = integrationIdFor(configuration, provider);
      const response = await fetcher(
        nangoUrl(nango.baseUrl, "/connect/sessions"),
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(authorizationHeaders(nango.apiKey)),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            end_user: {
              id: actor.principal.id,
              email: actor.principal.email,
              display_name: actor.principal.displayName,
            },
            organization: { id: `user:${actor.principal.id}` },
            allowed_integrations: [integrationId],
            tags: {
              organization_id: `user:${actor.principal.id}`,
              agency_id: String(agencyId),
            },
          }),
        },
      );
      if (!response.ok) throw new CrmUpstreamError();
      const payload = (await response.json().catch(() => undefined)) as
        { data?: { token?: unknown; expires_at?: unknown } } | undefined;
      const token = readString(payload?.data?.token);
      const expiresAt = readString(payload?.data?.expires_at);
      if (!token || !expiresAt) throw new CrmUpstreamError();
      return {
        token,
        expiresAt,
        connectUrl: nango.connectUrl,
        apiUrl: nango.baseUrl,
      };
    },

    async getConnection(connectionId, integrationId) {
      const nango = configuredNango(configuration);
      const url = nangoUrl(
        nango.baseUrl,
        `/connections/${encodeURIComponent(connectionId)}`,
      );
      url.searchParams.set("provider_config_key", integrationId);
      const response = await fetcher(url, {
        headers: authorizationHeaders(nango.apiKey),
      });
      if (!response.ok) throw new CrmUpstreamError();
      const payload: unknown = await response.json().catch(() => undefined);
      const direct =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : undefined;
      const data =
        direct?.data &&
        typeof direct.data === "object" &&
        !Array.isArray(direct.data)
          ? (direct.data as Record<string, unknown>)
          : direct;
      if (!data) throw new CrmUpstreamError();
      const organization = data.organization;
      const endUser = data.end_user;
      const organizationId =
        organization && typeof organization === "object"
          ? (readString((organization as Record<string, unknown>).id) ?? null)
          : endUser &&
              typeof endUser === "object" &&
              (endUser as Record<string, unknown>).organization &&
              typeof (endUser as Record<string, unknown>).organization ===
                "object"
            ? (readString(
                (
                  (endUser as Record<string, unknown>).organization as Record<
                    string,
                    unknown
                  >
                ).id,
              ) ?? null)
            : null;
      const scopes = scopeSummary(data);
      const summary: NangoConnectionSummary = {
        connectionId: readString(data.connection_id) ?? connectionId,
        providerConfigKey:
          readString(data.provider_config_key) ?? integrationId,
        organizationId,
        metadata: safeMetadata(data.metadata),
        ...(safeConnectionConfig(data.connection_config)
          ? { connectionConfig: safeConnectionConfig(data.connection_config) }
          : {}),
        ...scopes,
      };
      console.info({
        event: "crm.nango.connection_scopes",
        provider:
          data.provider_config_key === configuration.salesforceIntegrationId
            ? "salesforce"
            : data.provider_config_key === configuration.zohoIntegrationId
              ? "zoho"
              : data.provider_config_key ===
                  configuration.pipedriveIntegrationId
                ? "pipedrive"
                : "hubspot",
        scopeSource: summary.scopeSource,
        scopeCount: summary.scopes.length,
      });
      return summary;
    },

    async deleteConnection(connectionId, integrationId) {
      const nango = configuredNango(configuration);
      const url = nangoUrl(
        nango.baseUrl,
        `/connections/${encodeURIComponent(connectionId)}`,
      );
      url.searchParams.set("provider_config_key", integrationId);
      const response = await fetcher(url, {
        method: "DELETE",
        headers: authorizationHeaders(nango.apiKey),
      });
      if (!response.ok) throw new CrmUpstreamError();
    },

    async proxy(request) {
      const provider = request.connection.provider;
      const configuredId = configuredIntegrationIds(configuration)[provider];
      if (
        !configuredId ||
        configuredId !== request.connection.nangoIntegrationId
      )
        throw new CrmUnavailableError(
          "The requested CRM operation is unavailable",
        );
      const allowed =
        provider === "hubspot"
          ? allowedHubSpotProxyPath(request.path)
          : allowedNativeProxyRequest(request);
      if (!allowed)
        throw new CrmUnavailableError(
          "The requested CRM operation is unavailable",
        );
      const nango = requireConfiguredNango(configuration);
      try {
        return await fetcher(nangoUrl(nango.baseUrl, `/proxy${request.path}`), {
          method: request.method,
          signal: AbortSignal.timeout(10_000),
          // Workers supports manual/follow. Return redirects as non-OK responses
          // instead of forwarding the integration credentials to another URL.
          redirect: "manual",
          headers: proxyHeaders(nango.apiKey, request),
          body:
            request.body === undefined
              ? undefined
              : JSON.stringify(request.body),
        });
      } catch {
        throw new CrmUpstreamError();
      }
    },
  };
}
