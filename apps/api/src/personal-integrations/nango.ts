import type { NangoConfiguration } from "../external-crm/nango";
import type { AppActor } from "../auth/types";
import type {
  PersonalIntegrationNangoClient,
  PersonalIntegrationProviderId,
  PersonalNangoConnectionSummary,
} from "./contracts";
import {
  PersonalIntegrationUnavailableError,
  PersonalIntegrationUpstreamError,
} from "./contracts";

type ConfiguredNango = {
  baseUrl: string;
  connectUrl: string;
  apiKey: string;
  fallbackApiKey?: string;
};

function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizedUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function requireConfigured(configuration: NangoConfiguration): ConfiguredNango {
  const baseUrl = normalizedUrl(configuration.baseUrl);
  const apiKey = configuredValue(configuration.apiKey);
  if (!baseUrl || !apiKey) throw new PersonalIntegrationUnavailableError();
  return {
    baseUrl,
    connectUrl: normalizedUrl(configuration.connectUrl) ?? baseUrl,
    apiKey,
    fallbackApiKey: configuredValue(configuration.fallbackApiKey),
  };
}

function missingConnection(response: Response): Promise<boolean> {
  if (response.status !== 400) return Promise.resolve(false);
  return response
    .clone()
    .json()
    .then((payload: unknown) => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return false;
      const error = (payload as Record<string, unknown>).error;
      if (!error || typeof error !== "object" || Array.isArray(error))
        return false;
      const detail = error as Record<string, unknown>;
      return (
        detail.code === "unknown_connection" ||
        (detail.code === "server_error" &&
          detail.message === "Failed to get connection")
      );
    })
    .catch(() => false);
}

function fallbackReadPost(request: {
  method: string;
  path: string;
  body?: unknown;
  rawBody?: string | Uint8Array<ArrayBuffer>;
  connection: { provider: string };
}): boolean {
  let url: URL;
  try {
    url = new URL(request.path, "https://savia.invalid");
  } catch {
    return false;
  }
  if (url.origin !== "https://savia.invalid") return false;
  if (
    request.method === "POST" &&
    request.connection.provider === "jira" &&
    /^\/ex\/jira\/[^/]+\/rest\/api\/3\/search\/jql$/.test(url.pathname)
  )
    return true;
  if (
    request.method !== "POST" ||
    request.connection.provider !== "github" ||
    url.pathname !== "/graphql" ||
    url.search
  )
    return false;

  let body: unknown = request.body;
  if (request.rawBody !== undefined) {
    try {
      body = JSON.parse(
        typeof request.rawBody === "string"
          ? request.rawBody
          : new TextDecoder().decode(request.rawBody),
      );
    } catch {
      return false;
    }
  } else if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return false;
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const payload = body as Record<string, unknown>;
  if (typeof payload.query !== "string") return false;
  const query = payload.query
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/#[^\n\r]*/g, " ");
  const start = /^\s*query(?:\s+([_A-Za-z][_0-9A-Za-z]*))?(?=\s|\()/;
  const match = start.exec(query);
  if (
    !match ||
    /\b(?:mutation|subscription)\b/.test(query.slice(match[0].length)) ||
    /\bquery\s+[_A-Za-z][_0-9A-Za-z]*/.test(query.slice(match[0].length))
  )
    return false;
  return (
    payload.operationName === undefined || payload.operationName === match[1]
  );
}

function nangoUrl(baseUrl: string, path: string): URL {
  return new URL(`${baseUrl}${path}`);
}

function headers(apiKey: string): Headers {
  return new Headers({ authorization: `Bearer ${apiKey}` });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      typeof item === "string" ? [[key, item]] : [],
    ),
  );
}

function safeMetadata(value: unknown): Record<string, string | string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const metadata = value as Record<string, unknown>;
  const result: Record<string, string | string[]> = {};
  for (const key of ["scopes", "account_name", "account_id", "email"]) {
    const item = metadata[key];
    if (typeof item === "string") result[key] = item;
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string"))
      result[key] = item;
  }
  return result;
}

function sessionFromPayload(
  payload: unknown,
  nango: ConfiguredNango,
): { token: string; expiresAt: string; connectUrl: string; apiUrl: string } {
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
  const token = readString(data?.token);
  const expiresAt = readString(data?.expires_at);
  if (!token || !expiresAt) throw new PersonalIntegrationUpstreamError();
  return {
    token,
    expiresAt,
    connectUrl: nango.connectUrl,
    apiUrl: nango.baseUrl,
  };
}

function sessionTags(actor: AppActor): Record<string, string> {
  return {
    end_user_id: actor.principal.id,
    end_user_email: actor.principal.email,
    end_user_display_name: actor.principal.displayName,
  };
}

export function createPersonalIntegrationNangoClient(
  configuration: NangoConfiguration,
  fetcher: typeof fetch = fetch,
): PersonalIntegrationNangoClient {
  return {
    async createConnectSession({ actor, integrationId }) {
      const nango = requireConfigured(configuration);
      const response = await fetcher(
        nangoUrl(nango.baseUrl, "/connect/sessions"),
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(headers(nango.apiKey)),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            tags: sessionTags(actor),
            allowed_integrations: [integrationId],
          }),
        },
      ).catch(() => undefined);
      if (!response?.ok) throw new PersonalIntegrationUpstreamError();
      return sessionFromPayload(
        await response.json().catch(() => undefined),
        nango,
      );
    },

    async createReconnectSession({ connectionId, integrationId }) {
      const nango = requireConfigured(configuration);
      const response = await fetcher(
        nangoUrl(nango.baseUrl, "/connect/sessions/reconnect"),
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(headers(nango.apiKey)),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            connection_id: connectionId,
            integration_id: integrationId,
          }),
        },
      ).catch(() => undefined);
      if (!response?.ok) throw new PersonalIntegrationUpstreamError();
      return sessionFromPayload(
        await response.json().catch(() => undefined),
        nango,
      );
    },

    async getConnection(connectionId, integrationId) {
      const nango = requireConfigured(configuration);
      const url = nangoUrl(
        nango.baseUrl,
        `/connections/${encodeURIComponent(connectionId)}`,
      );
      url.searchParams.set("provider_config_key", integrationId);
      const response = await fetcher(url, {
        headers: headers(nango.apiKey),
      }).catch(() => undefined);
      if (!response?.ok) throw new PersonalIntegrationUpstreamError();
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
      if (!data) throw new PersonalIntegrationUpstreamError();
      const result: PersonalNangoConnectionSummary = {
        connectionId: readString(data.connection_id) ?? connectionId,
        providerConfigKey:
          readString(data.provider_config_key) ?? integrationId,
        tags: safeStrings(data.tags),
        metadata: safeMetadata(data.metadata),
      };
      return result;
    },

    async deleteConnection(connectionId, integrationId) {
      const nango = requireConfigured(configuration);
      const url = nangoUrl(
        nango.baseUrl,
        `/connections/${encodeURIComponent(connectionId)}`,
      );
      url.searchParams.set("provider_config_key", integrationId);
      const response = await fetcher(url, {
        method: "DELETE",
        headers: headers(nango.apiKey),
      }).catch(() => undefined);
      if (response?.ok || response?.status === 404) return;
      if (response?.status === 400) {
        const payload: unknown = await response.json().catch(() => undefined);
        if (payload && typeof payload === "object" && "error" in payload) {
          const error = payload.error;
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "unknown_connection"
          )
            return;
        }
      }
      throw new PersonalIntegrationUpstreamError();
    },

    async proxy(request) {
      if (
        !request.path.startsWith("/") ||
        request.path.startsWith("//") ||
        request.path.includes("\\")
      )
        throw new PersonalIntegrationUnavailableError();
      const nango = requireConfigured(configuration);
      try {
        const hasBody =
          request.body !== undefined || request.rawBody !== undefined;
        const url = nangoUrl(nango.baseUrl, `/proxy${request.path}`);
        const init: RequestInit = {
          method: request.method,
          ...(request.redirect ? { redirect: request.redirect } : {}),
          headers: {
            ...Object.fromEntries(headers(nango.apiKey)),
            "connection-id": request.connection.nangoConnectionId,
            "provider-config-key": request.connection.nangoIntegrationId,
            // Nango's OneDrive Personal provider defaults to api.onedrive.com,
            // while Savia uses Graph paths and Graph-scoped Microsoft tokens.
            ...(request.connection.provider === "onedrive_personal"
              ? { "base-url-override": "https://graph.microsoft.com" }
              : request.connection.provider === "jira"
                ? { "base-url-override": "https://api.atlassian.com" }
                : request.connection.provider === "linear"
                  ? { "base-url-override": "https://api.linear.app" }
                  : request.connection.provider === "github"
                    ? { "base-url-override": "https://api.github.com" }
                    : request.connection.provider === "zoom"
                      ? { "base-url-override": "https://api.zoom.us" }
                      : {}),
            ...(hasBody
              ? { "content-type": request.contentType ?? "application/json" }
              : {}),
            ...Object.fromEntries(
              Object.entries(request.upstreamHeaders ?? {}).map(
                ([key, value]) => [`nango-proxy-${key}`, value],
              ),
            ),
          },
          body:
            request.rawBody ??
            (request.body === undefined
              ? undefined
              : JSON.stringify(request.body)),
        };
        const response = await fetcher(url, init);
        if (
          nango.fallbackApiKey &&
          nango.fallbackApiKey !== nango.apiKey &&
          (request.method === "GET" || fallbackReadPost(request)) &&
          (await missingConnection(response))
        ) {
          const fallbackHeaders = new Headers(init.headers);
          fallbackHeaders.set(
            "authorization",
            `Bearer ${nango.fallbackApiKey}`,
          );
          return await fetcher(url, { ...init, headers: fallbackHeaders });
        }
        return response;
      } catch {
        throw new PersonalIntegrationUpstreamError();
      }
    },
  };
}
