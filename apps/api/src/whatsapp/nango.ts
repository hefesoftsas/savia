import type {
  ActiveWhatsappConnection,
  WhatsappConnectionSummary,
  WhatsappNangoClient,
  WhatsappProxyRequest,
} from "./contracts";
import { WhatsappUnavailableError, WhatsappUpstreamError } from "./contracts";

export type WhatsappNangoConfiguration = {
  baseUrl?: string;
  connectUrl?: string;
  apiKey?: string;
  whatsappIntegrationId?: string;
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

function configuredNango(configuration: WhatsappNangoConfiguration): {
  baseUrl: string;
  connectUrl: string;
  apiKey: string;
} {
  const baseUrl = normalizedUrl(configuration.baseUrl);
  const apiKey = configuredValue(configuration.apiKey);
  if (!baseUrl || !apiKey) throw new WhatsappUnavailableError();
  return {
    baseUrl,
    connectUrl: normalizedUrl(configuration.connectUrl) ?? baseUrl,
    apiKey,
  };
}

export function whatsappIntegrationIdFor(
  configuration: WhatsappNangoConfiguration,
): string {
  const id = configuredValue(configuration.whatsappIntegrationId);
  if (!id) throw new WhatsappUnavailableError();
  return id;
}

export function isWhatsappNangoConfigured(
  configuration: WhatsappNangoConfiguration,
): boolean {
  return (
    typeof configuredValue(configuration.baseUrl) === "string" &&
    typeof configuredValue(configuration.apiKey) === "string" &&
    typeof configuredValue(configuration.whatsappIntegrationId) === "string"
  );
}

function nangoUrl(baseUrl: string, path: string): URL {
  return new URL(`${baseUrl}${path}`);
}

function authorizationHeaders(apiKey: string): Headers {
  return new Headers({ authorization: `Bearer ${apiKey}` });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeMetadata(value: unknown): Record<string, string | string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, string | string[]> = {};
  for (const key of [
    "phone_number_id",
    "display_phone_number",
    "waba_id",
    "business_name",
    "account_name",
  ]) {
    const item = source[key];
    if (typeof item === "string") result[key] = item;
  }
  return result;
}

const graphVersionPattern = /^\/v\d{2}\.\d+/;
const graphResourcePattern =
  /^\/v\d{2}\.\d+\/(?:me|\d{5,20}(?:\/(?:messages|message_templates|phone_numbers))?)$/;

export function allowedWhatsappProxyPath(
  method: "GET" | "POST",
  path: string,
): boolean {
  let url: URL;
  try {
    url = new URL(path, "https://savia.invalid");
  } catch {
    return false;
  }
  if (url.origin !== "https://savia.invalid") return false;
  if (!graphVersionPattern.test(url.pathname)) return false;
  if (!graphResourcePattern.test(url.pathname)) return false;
  if (method === "POST") return url.pathname.endsWith("/messages");
  return method === "GET";
}

function proxyHeaders(apiKey: string, request: WhatsappProxyRequest): Headers {
  const headers = authorizationHeaders(apiKey);
  headers.set("connection-id", request.connection.nangoConnectionId);
  headers.set("provider-config-key", request.connection.nangoIntegrationId);
  if (request.body !== undefined)
    headers.set("content-type", "application/json");
  return headers;
}

export function createWhatsappNangoClient(
  configuration: WhatsappNangoConfiguration,
  fetcher: typeof fetch = fetch,
): WhatsappNangoClient {
  return {
    async createConnectSession({ actor, agencyId }) {
      const nango = configuredNango(configuration);
      const integrationId = whatsappIntegrationIdFor(configuration);
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
      if (!response.ok) throw new WhatsappUpstreamError();
      const payload = (await response.json().catch(() => undefined)) as
        { data?: { token?: unknown; expires_at?: unknown } } | undefined;
      const token = readString(payload?.data?.token);
      const expiresAt = readString(payload?.data?.expires_at);
      if (!token || !expiresAt) throw new WhatsappUpstreamError();
      return {
        token,
        expiresAt,
        connectUrl: nango.connectUrl,
        apiUrl: nango.baseUrl,
      };
    },

    async createReconnectSession({ connectionId, integrationId }) {
      const nango = configuredNango(configuration);
      const response = await fetcher(
        nangoUrl(nango.baseUrl, "/connect/sessions/reconnect"),
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(authorizationHeaders(nango.apiKey)),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            connection_id: connectionId,
            integration_id: integrationId,
          }),
        },
      );
      if (!response.ok) throw new WhatsappUpstreamError();
      const payload = (await response.json().catch(() => undefined)) as
        { data?: { token?: unknown; expires_at?: unknown } } | undefined;
      const token = readString(payload?.data?.token);
      const expiresAt = readString(payload?.data?.expires_at);
      if (!token || !expiresAt) throw new WhatsappUpstreamError();
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
      if (!response.ok) throw new WhatsappUpstreamError();
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
      if (!data) throw new WhatsappUpstreamError();
      const endUser =
        data.end_user &&
        typeof data.end_user === "object" &&
        !Array.isArray(data.end_user)
          ? (data.end_user as Record<string, unknown>)
          : undefined;
      const organization = data.organization ?? endUser?.organization;
      const organizationId =
        organization && typeof organization === "object"
          ? (readString((organization as Record<string, unknown>).id) ?? null)
          : null;
      const tags =
        data.tags && typeof data.tags === "object" && !Array.isArray(data.tags)
          ? (data.tags as Record<string, unknown>)
          : undefined;
      const agencyTag = readString(tags?.agency_id);
      const parsedAgencyId =
        agencyTag && /^[1-9]\d*$/.test(agencyTag)
          ? Number(agencyTag)
          : Number.NaN;
      const summary: WhatsappConnectionSummary = {
        connectionId: readString(data.connection_id) ?? connectionId,
        providerConfigKey:
          readString(data.provider_config_key) ?? integrationId,
        organizationId,
        agencyId: Number.isSafeInteger(parsedAgencyId) ? parsedAgencyId : null,
        metadata: safeMetadata(data.metadata),
      };
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
      if (!response.ok) throw new WhatsappUpstreamError();
    },

    async proxy(request) {
      const configuredId = configuredValue(configuration.whatsappIntegrationId);
      if (
        !configuredId ||
        configuredId !== request.connection.nangoIntegrationId
      )
        throw new WhatsappUnavailableError(
          "The requested WhatsApp operation is unavailable",
        );
      if (!allowedWhatsappProxyPath(request.method, request.path))
        throw new WhatsappUnavailableError(
          "The requested WhatsApp operation is unavailable",
        );
      const nango = configuredNango(configuration);
      try {
        return await fetcher(nangoUrl(nango.baseUrl, `/proxy${request.path}`), {
          method: request.method,
          signal: AbortSignal.timeout(10_000),
          redirect: "manual",
          headers: proxyHeaders(nango.apiKey, request),
          body:
            request.body === undefined
              ? undefined
              : JSON.stringify(request.body),
        });
      } catch {
        throw new WhatsappUpstreamError();
      }
    },
  };
}
