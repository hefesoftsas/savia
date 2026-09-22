import {
  createPluginApi,
  type PluginApi,
  type PluginHostRequest,
} from "@savia/crm-shared/plugin-api";
import {
  releaseCatalog,
  type ExtensionWidgetContribution,
} from "@savia/release-catalog";
import type { ApiClient } from "@/api/api-client";
import type { MyDayWidget } from "@savia/crm-shared/my-day-widgets";

export type PluginWidgetRef = {
  extensionId: string;
  widgetId: string;
};

export type ExtensionInstallation = {
  manifest: { id: string };
  builtIn: boolean;
  installed: { enabled: boolean } | null;
};

export function parsePluginKind(kind: string): PluginWidgetRef | null {
  const match = kind.match(/^plugin:([a-z0-9_.-]{1,64}):([a-z0-9_-]{1,64})$/);
  if (!match) return null;
  return { extensionId: match[1], widgetId: match[2] };
}

export function pluginContributionFor(
  ref: PluginWidgetRef,
): ExtensionWidgetContribution | undefined {
  return releaseCatalog.extensionWidgets.find(
    (entry) =>
      entry.extensionId === ref.extensionId && entry.id === ref.widgetId,
  );
}

export function pluginWidgetTitle(kind: string): string | undefined {
  const ref = parsePluginKind(kind);
  return ref ? pluginContributionFor(ref)?.title.es : undefined;
}

export function availablePluginWidgets(
  collection: string,
  extensions: readonly ExtensionInstallation[] | undefined,
): ExtensionWidgetContribution[] {
  if (!extensions) return [];
  return releaseCatalog.extensionWidgets.filter(
    (entry) =>
      entry.collection === collection &&
      isPluginWidgetEnabled(entry, extensions),
  );
}

export function isPluginWidgetEnabled(
  contribution: ExtensionWidgetContribution | undefined,
  extensions: readonly ExtensionInstallation[] | undefined,
): boolean {
  if (!contribution || !extensions) return false;
  return extensions.some(
    (entry) =>
      entry.manifest.id === contribution.extensionId &&
      (entry.builtIn || entry.installed?.enabled === true),
  );
}

export function pluginRequestFor(
  apiClient: ApiClient,
  apiBasePath: string,
): PluginHostRequest {
  return async <T>(
    path: string,
    method = "GET",
    data?: unknown,
    options?: { responseType?: "blob" },
  ): Promise<T> => {
    const url = `${apiBasePath}/api${path}`;
    if (data instanceof FormData || options?.responseType === "blob") {
      const response = await apiClient.requestResponse(
        url,
        data instanceof FormData ? { method, body: data } : { method },
      );
      if (!response.ok) {
        const failure = await response.json().catch(() => undefined);
        const message =
          typeof failure?.error === "string"
            ? failure.error
            : (failure?.error?.message ?? `Error ${response.status}`);
        throw new Error(message);
      }
      if (options?.responseType === "blob") return (await response.blob()) as T;
      return (await response.json()) as T;
    }
    switch (method) {
      case "POST":
        return apiClient.post<T>(url, data);
      case "PATCH":
        return apiClient.patch<T>(url, data);
      case "PUT":
        return apiClient.put<T>(url, data);
      case "DELETE":
        await apiClient.delete(url);
        return undefined as T;
      default:
        return apiClient.get<T>(url);
    }
  };
}

export function pluginApiFor(
  extensionId: string,
  apiClient: ApiClient,
  apiBasePath: string,
): PluginApi {
  return createPluginApi({
    extensionId,
    request: pluginRequestFor(apiClient, apiBasePath),
  });
}

export async function listWidgetExtensions(
  apiClient: ApiClient,
  apiBasePath: string,
  options?: { signal?: AbortSignal },
): Promise<ExtensionInstallation[]> {
  return (
    await apiClient.get<{ data: ExtensionInstallation[] }>(
      `${apiBasePath}/api/extensions`,
      { signal: options?.signal },
    )
  ).data;
}
