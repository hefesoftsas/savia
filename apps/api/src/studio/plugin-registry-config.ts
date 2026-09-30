export type TenantPluginRegistry = { url: string; token: string };

/** Deployment secrets explicitly map local tenant IDs to private namespaces. */
export function pluginRegistryForTenant(
  raw: string | undefined,
  tenant: string,
): TenantPluginRegistry | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const map: unknown = JSON.parse(raw);
    if (!map || typeof map !== "object" || Array.isArray(map))
      throw new Error();
    const entries = Object.entries(map);
    for (const [key, value] of entries) {
      if (
        !/^tenant:(0|[1-9][0-9]*)$/.test(key) ||
        !value ||
        typeof value !== "object"
      )
        throw new Error();
      const { url, token } = value as Record<string, unknown>;
      if (
        typeof url !== "string" ||
        typeof token !== "string" ||
        token.length < 32 ||
        /\s/.test(token)
      )
        throw new Error();
      const endpoint = new URL(url);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(
        endpoint.hostname,
      );
      if (
        (endpoint.protocol !== "https:" &&
          !(local && endpoint.protocol === "http:")) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.pathname !== "/" ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error();
    }
    if (!Object.hasOwn(map, tenant)) return undefined;
    const { url, token } = (map as Record<string, TenantPluginRegistry>)[
      tenant
    ];
    return { url: new URL(url).origin, token };
  } catch {
    // Never include the secret JSON or URL in an exception.
    throw new Error("Invalid PLUGIN_REGISTRY_TENANTS configuration");
  }
}

/** A broken optional registry must not take the tenant's local runtime offline. */
export function runtimePluginRegistryForTenant(
  raw: string | undefined,
  tenant: string,
): TenantPluginRegistry | undefined {
  try {
    return pluginRegistryForTenant(raw, tenant);
  } catch {
    // Deliberately invalid origin: only registry endpoints return unavailable.
    return { url: "invalid:registry", token: "unavailable" };
  }
}
