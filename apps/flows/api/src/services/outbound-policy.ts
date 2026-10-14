/** Service bindings are explicit capabilities; public fetch is denied in preview. */
export function guardedFetch(
  fetcher: typeof fetch,
  env: { SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED?: string },
): typeof fetch {
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    if (env.SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED !== "true") {
      throw new Error("External services are disabled for Savia Flows");
    }
    return fetcher(...args);
  };
}
