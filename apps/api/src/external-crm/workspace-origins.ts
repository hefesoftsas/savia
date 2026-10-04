import type {
  ActiveCrmConnection,
  NangoClient,
  NangoConnectionSummary,
} from "./contracts";
import type {
  RemoteProviderId,
  RemoteWorkspaceAdapter,
  WorkspaceResource,
} from "./workspace-adapter";

type PublicConfig = NonNullable<NangoConnectionSummary["connectionConfig"]>;
function secureHost(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      ["", "/"].includes(url.pathname)
      ? url.hostname
      : undefined;
  } catch {
    return;
  }
}
export function crmRecordOrigin(
  provider: RemoteProviderId,
  config: PublicConfig,
  accountId: string,
  resource: WorkspaceResource,
  id: string,
) {
  if (!/^[A-Za-z0-9]+$/.test(id)) return;
  if (provider === "salesforce") {
    const host = secureHost(config.instanceUrl);
    if (
      !host ||
      !/^[a-z0-9-]+(?:\.sandbox)?\.my\.salesforce\.com$/.test(host) ||
      !/^(?:[A-Za-z0-9]{15}|[A-Za-z0-9]{18})$/.test(id)
    )
      return;
    const object = {
      contacts: "Contact",
      companies: "Account",
      deals: "Opportunity",
    }[resource];
    return {
      provider,
      label: "Open in Salesforce",
      url: `https://${host.replace(/\.my\.salesforce\.com$/, ".lightning.force.com")}/lightning/r/${object}/${id}/view`,
    };
  }
  if (provider === "pipedrive") {
    const host = secureHost(config.apiDomain);
    if (
      !host ||
      !/^[a-z0-9-]+\.pipedrive\.com$/.test(host) ||
      host === "api.pipedrive.com" ||
      !/^\d+$/.test(id)
    )
      return;
    const object = {
      contacts: "person",
      companies: "organization",
      deals: "deal",
    }[resource];
    return {
      provider,
      label: "Open in Pipedrive",
      url: `https://${host}/${object}/${id}`,
    };
  }
  const region =
    config.extension ??
    secureHost(config.apiDomain)?.match(
      /^www\.zohoapis\.(com|eu|in|jp|com\.au|com\.cn|sa|ca)$/,
    )?.[1];
  if (
    !region ||
    !["com", "eu", "in", "jp", "com.au", "com.cn", "sa", "ca"].includes(
      region,
    ) ||
    !/^\d+$/.test(accountId) ||
    !/^\d+$/.test(id)
  )
    return;
  const object = {
    contacts: "Contacts",
    companies: "Accounts",
    deals: "Deals",
  }[resource];
  return {
    provider,
    label: "Open in Zoho CRM",
    url: `https://crm.zoho.${region}/crm/org${accountId}/tab/${object}/${id}`,
  };
}

/** Origin links are optional, derived only from the authenticated Nango connection. */
export function withCrmOrigins(
  adapter: RemoteWorkspaceAdapter,
  provider: RemoteProviderId,
  nango: NangoClient,
): RemoteWorkspaceAdapter {
  const configs = new Map<string, PublicConfig>();
  const loaded = new Set<string>();
  const key = (connection: ActiveCrmConnection) =>
    JSON.stringify([
      connection.id,
      connection.nangoConnectionId,
      connection.nangoIntegrationId,
      connection.externalAccountId,
    ]);
  return {
    ...adapter,
    async describe(connection, resource) {
      const description = await adapter.describe(connection, resource);
      const cacheKey = key(connection);
      if (!loaded.has(cacheKey)) {
        loaded.add(cacheKey);
        try {
          const summary = await nango.getConnection(
            connection.nangoConnectionId,
            connection.nangoIntegrationId,
          );
          if (
            summary.connectionId === connection.nangoConnectionId &&
            summary.providerConfigKey === connection.nangoIntegrationId &&
            summary.connectionConfig
          )
            configs.set(cacheKey, summary.connectionConfig);
        } catch {
          /* The record remains usable if optional origin metadata is unavailable. */
        }
      }
      return description;
    },
    origin(connection, resource, id) {
      const config = configs.get(key(connection));
      return config && connection.externalAccountId
        ? crmRecordOrigin(
            provider,
            config,
            connection.externalAccountId,
            resource,
            id,
          )
        : undefined;
    },
  };
}
