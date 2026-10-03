import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { ApiClient } from "@/api/api-client";
type Availability = { enabled: boolean; loading: boolean; error: boolean };
const unavailable: Availability = {
  enabled: false,
  loading: true,
  error: false,
};
export const OfficeAvailabilityContext =
  createContext<Availability>(unavailable);
export function useOfficeAvailability() {
  return useContext(OfficeAvailabilityContext);
}
export function OfficeAvailabilityProvider({
  apiClient,
  tenantId,
  children,
}: PropsWithChildren<{ apiClient: ApiClient; tenantId?: number }>) {
  const path =
    tenantId === undefined
      ? "/v1/office-settings"
      : `/v1/tenants/${tenantId}/office-settings`;
  const generation = useRef(0);
  const [state, setState] = useState<Availability & { path: string }>({
    ...unavailable,
    path,
  });
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const response = await apiClient.get<{ data: { enabled: boolean } }>(
        path,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (request === generation.current)
        setState({
          path,
          enabled: response.data.enabled === true,
          loading: false,
          error: false,
        });
    } catch {
      if (request === generation.current)
        setState({ path, enabled: false, loading: false, error: true });
    }
  }, [apiClient, path]);
  useEffect(() => {
    setState({ ...unavailable, path });
    void refresh();
    const update = () => {
      void refresh();
    };
    const identity = () => {
      setState({ ...unavailable, path });
      void refresh();
    };
    window.addEventListener("focus", update);
    window.addEventListener("savia:office-settings-changed", update);
    window.addEventListener("savia:identity-changed", identity);
    window.addEventListener("savia:active-tenant-changed", identity);
    window.addEventListener("savia:session-cleared", identity);
    return () => {
      generation.current++;
      window.removeEventListener("focus", update);
      window.removeEventListener("savia:office-settings-changed", update);
      window.removeEventListener("savia:identity-changed", identity);
      window.removeEventListener("savia:active-tenant-changed", identity);
      window.removeEventListener("savia:session-cleared", identity);
    };
  }, [refresh, path]);
  return (
    <OfficeAvailabilityContext.Provider
      value={state.path === path ? state : unavailable}
    >
      {children}
    </OfficeAvailabilityContext.Provider>
  );
}
