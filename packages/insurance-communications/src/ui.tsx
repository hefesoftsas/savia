import { useEffect, useState } from "react";
import type {
  PluginApi,
  PluginExtensionActionRun,
  PluginExtensionConnectionSummary,
} from "@savia/crm-shared/plugin-api";
import type { Receipt } from "./gateway";
export function useIntegration(savia: PluginApi) {
  const [connections, setConnections] = useState<
      PluginExtensionConnectionSummary[]
    >([]),
    [runs, setRuns] = useState<PluginExtensionActionRun[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  async function refresh() {
    try {
      const [c, r] = await Promise.all([
        savia.connections.list(),
        savia.actions.list(),
      ]);
      setConnections(c);
      setRuns(r);
    } catch {
      setError(
        "No se pudo cargar la conexión o el historial. Vuelve a intentar.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [savia]);
  async function execute(
    action: string,
    payload: Record<string, unknown>,
    operationKey: string,
    connectionId?: string,
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await savia.actions.execute<Receipt>(action, {
        connectionId: connectionId ?? connections[0]?.connectionId,
        input: { payload, operationKey },
      });
      await refresh();
      return result.output;
    } catch {
      setError(
        "No se confirmó la operación. Consulta el historial o al proveedor antes de reintentar; se conserva la referencia.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }
  return {
    savia,
    connections,
    runs,
    error,
    setError,
    busy,
    loading,
    refresh,
    execute,
  };
}
