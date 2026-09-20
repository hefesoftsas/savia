import { usePluginMessages } from "@savia/crm-shared/plugin-locale-react";
import { integrationMessages } from "./locales";
import { useEffect, useState } from "react";
import type {
  PluginApi,
  PluginExtensionActionRun,
  PluginExtensionConnectionSummary,
} from "@savia/crm-shared/plugin-api";
import { stateLabels } from "./domain";
import type { Receipt } from "./gateway";
import "./integrations.css";
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
export function History({ runs }: { runs: PluginExtensionActionRun[] }) {
 const t = usePluginMessages(integrationMessages);
  return (
    <section>
      <h2>{t("Historial de operaciones")}</h2>
      {!runs.length ? (
        <p>{t("No hay operaciones registradas.")}</p>
      ) : (
        <div className="integration-table">
          <table>
            <thead>
              <tr>
                <th>{t("Fecha")}</th>
                <th>{t("Operación")}</th>
                <th>{t("Resultado")}</th>
                <th>{t("Referencia")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const receipt = run.output as Partial<Receipt> | null;
                return (
                  <tr key={run.runId}>
                    <td>{new Date(run.createdAt).toLocaleString("es-CO")}</td>
                    <td>{run.actionId}</td>
                    <td>
                      {receipt?.state
                        ? stateLabels[receipt.state]
                        : run.status === "failed"
                          ? t("No confirmado / revisar")
                          : run.status === "pending"
                            ? t("Procesando")
                            : t("Consultar referencia")}
                    </td>
                    <td>{receipt?.reference ?? run.runId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
export function IntegrationStatus({
  state,
  connectorId,
}: {
  state: ReturnType<typeof useIntegration>;
  connectorId: string;
}) {
 const t = usePluginMessages(integrationMessages);
  const [endpoint, setEndpoint] = useState(""),
    [token, setToken] = useState(""),
    [saving, setSaving] = useState(false);
  return (
    <>
      {state.loading ? (
        <p role="status">{t("Cargando conexiones…")}</p>
      ) : !state.connections.length ? (
        <p role="status">
          {t("Sin conexión configurada. Registra una conexión cifrada con un destino autorizado por el administrador.")}</p>
      ) : (
        <p>
          {t("Conexión disponible:")}{" "}
          {state.connections.map((c) => c.connectionId).join(", ")}
        </p>
      )}
      {state.error ? <p role="alert">{state.error}</p> : null}
      <details>
        <summary>{t("Configurar conexión de integración")}</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              await state.savia.connections.replace("main", {
                connectorId,
                values: { endpoint, token },
              });
              setToken("");
              await state.refresh();
            } catch {
              state.setError(
                "No se guardó la conexión. Revisa tus permisos, el identificador y el destino autorizado.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            {t("Endpoint HTTPS autorizado")}<input
              type="url"
              required
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </label>
          <label>
            {t("Token secreto")}<input
              type="password"
              autoComplete="new-password"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? t("Guardando…") : t("Guardar conexión cifrada")}
          </button>
        </form>
      </details>
    </>
  );
}
export function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="insurance-integration">
      <header>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </main>
  );
}
export async function loadAll(savia: PluginApi, object: string) {
  const records: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const result = await savia.collections
      .collection<Record<string, unknown>>(object)
      .list({ page, perPage: 100, sort: "id", order: "ASC" });
    if (total !== undefined && result.total !== total)
      throw Error("La colección cambió. Vuelve a cargarla.");
    total = result.total;
    for (const row of result.data) {
      const id = String(row.id ?? "");
      if (!id || ids.has(id))
        throw Error("Paginación no válida. Vuelve a cargarla.");
      ids.add(id);
      records.push(row);
    }
    if (records.length === total) return records;
    if (records.length > total || !result.data.length)
      throw Error("La colección cambió. Vuelve a cargarla.");
  }
  throw Error("Demasiados registros; reduce el alcance desde el origen.");
}
