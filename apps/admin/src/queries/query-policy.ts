import { QueryCache, QueryClient } from "@tanstack/react-query";

import { isReadAccessDenied } from "./read-state";

export function createAdminQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isReadAccessDenied(error)) {
          // Keep the denial visible without retaining protected rows or retrying mutations.
          query.setState({ data: undefined, dataUpdatedAt: 0 });
        }
      },
    }),
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: 1,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: { networkMode: "always", retry: false },
    },
  });
}
