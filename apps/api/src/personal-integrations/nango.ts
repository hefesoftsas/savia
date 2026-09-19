import type { NangoConfiguration } from "../crm/nango";
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

type ConfiguredNango = { baseUrl: string; connectUrl: string; apiKey: string };

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
  };
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
    direct?.data && typeof direct.data === "object" && !Array.isArray(direct.data)
      ? (direct.data as Record<string, unknown>)
      : direct;
  const token = readString(data?.token);
  const expiresAt = readString(data?.expires_at);
  if (!token || !expiresAt) throw new PersonalIntegrationUpstreamError();
  return { token, expiresAt, connectUrl: nango.connectUrl, apiUrl: nango.baseUrl };
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
      const response = await fetcher(nangoUrl(nango.baseUrl, "/connect/sessions"), {
        method: "POST",
        headers: {
          ...Object.fromEntries(headers(nango.apiKey)),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tags: sessionTags(actor),
          allowed_integrations: [integrationId],
        }),
      }).catch(() => undefined);
      if (!response?.ok) throw new PersonalIntegrationUpstreamError();
      return sessionFromPayload(await response.json().catch(() => undefined), nango);
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
          body: JSON.stringify({ connection_id: connectionId, integration_id: integrationId }),
        },
      ).catch(() => undefined);
      if (!response?.ok) throw new PersonalIntegrationUpstreamError();
      return sessionFromPayload(await response.json().catch(() => undefined), nango);
    },

    async getConnection(connectionId, integrationId) {
      const nango = requireConfigured(configuration);
      const url = nangoUrl(
        nango.baseUrl,
        `/connections/${encodeURIComponent(connectionId)}`,
      );
      url.searchParams.set("provider_config_key", integrationId);
      const response = await fetcher(url, { headers: headers(nango.apiKey) }).catch(
        () => undefined,
      );
      if (!response?.ok) throw new PersonalIntegrationUpstreamError();
      const payload: unknown = await response.json().catch(() => undefined);
      const direct =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : undefined;
      const data =
        direct?.data && typeof direct.data === "object" && !Array.isArray(direct.data)
          ? (direct.data as Record<string, unknown>)
          : direct;
      if (!data) throw new PersonalIntegrationUpstreamError();
      const result: PersonalNangoConnectionSummary = {
        connectionId: readString(data.connection_id) ?? connectionId,
        providerConfigKey: readString(data.provider_config_key) ?? integrationId,
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
      if (!response?.ok) throw new PersonalIntegrationUpstreamError();
    },

    async proxy(request) {
      if (!request.path.startsWith("/") || request.path.startsWith("//"))
        throw new PersonalIntegrationUnavailableError();
      const nango = requireConfigured(configuration);
      try {
        const hasBody = request.body !== undefined || request.rawBody !== undefined;
        return await fetcher(nangoUrl(nango.baseUrl, `/proxy${request.path}`), {
          method: request.method,
          headers: {
            ...Object.fromEntries(headers(nango.apiKey)),
            "connection-id": request.connection.nangoConnectionId,
            "provider-config-key": request.connection.nangoIntegrationId,
            ...(hasBody
              ? { "content-type": request.contentType ?? "application/json" }
              : {}),
            ...Object.fromEntries(
              Object.entries(request.upstreamHeaders ?? {}).map(([key, value]) => [
                `nango-proxy-${key}`,
                value,
              ]),
            ),
          },
          body:
            request.rawBody ??
            (request.body === undefined ? undefined : JSON.stringify(request.body)),
        });
      } catch {
        throw new PersonalIntegrationUpstreamError();
      }
    },
  };
}
