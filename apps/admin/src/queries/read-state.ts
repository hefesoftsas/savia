export type ReadState =
  | "initial"
  | "ready"
  | "refreshing"
  | "refresh-error"
  | "initial-error"
  | "blocked";

export function deriveReadState({
  scopeReady,
  hasData,
  fetching,
  error,
  accessDenied,
}: {
  scopeReady: boolean;
  hasData: boolean;
  fetching: boolean;
  error: unknown;
  accessDenied: boolean;
}): ReadState {
  if (!scopeReady || accessDenied) return "blocked";
  if (hasData) {
    if (fetching) return "refreshing";
    if (error != null) return "refresh-error";
    return "ready";
  }
  if (error != null) return "initial-error";
  return "initial";
}
