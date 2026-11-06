const keyPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;

function routeUrl(href: string) {
  const url = new URL(href);
  const hashRouting = url.hash.startsWith("#/");
  const route = hashRouting ? new URL(url.hash.slice(1), url.origin) : url;
  return { url, route, hashRouting };
}

function parseState(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid plugin URL state.");
  const entries = Object.entries(value);
  if (
    entries.length > 16 ||
    entries.some(
      ([key, text]) =>
        !keyPattern.test(key) ||
        typeof text !== "string" ||
        text.length > 512 ||
        /[\u0000-\u001f\u007f]/.test(text),
    ) ||
    JSON.stringify(value).length > 2048
  )
    throw new Error("Invalid plugin URL state.");
  return Object.fromEntries(entries);
}

/** Only the current extension's public view identifiers cross the frame boundary. */
export function readPluginRoute(
  href: string,
  pluginId: string,
): Record<string, string> {
  const { route } = routeUrl(href);
  const prefix = `plugin.${pluginId}.`;
  const entries = [...route.searchParams]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => [key.slice(prefix.length), value] as const)
    .filter(
      ([key, value]) =>
        keyPattern.test(key) &&
        value.length <= 512 &&
        !/[\u0000-\u001f\u007f]/.test(value),
    );
  try {
    return parseState(Object.fromEntries(entries));
  } catch {
    return {};
  }
}

export function writePluginRoute(
  href: string,
  pluginId: string,
  state: unknown,
): URL {
  const value = parseState(state);
  const { url, route, hashRouting } = routeUrl(href);
  const prefix = `plugin.${pluginId}.`;
  for (const key of [...route.searchParams.keys()])
    if (key.startsWith(prefix) && keyPattern.test(key.slice(prefix.length)))
      route.searchParams.delete(key);
  for (const [key, text] of Object.entries(value))
    route.searchParams.set(prefix + key, text);
  if (hashRouting) url.hash = route.pathname + route.search;
  return url;
}
