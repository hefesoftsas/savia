import { useState } from "react";
import type {
  PluginApi,
  PluginExtensionActionRun,
  PluginExtensionConnectionSummary,
} from "@savia/studio-shared/plugin-api";
import { useWorkbenchMessages } from "./localization";
import "./workbench.css";

export type IntegrationReceipt = { state?: string; reference?: string };
export type IntegrationConnectionState = {
  savia: PluginApi;
  connections: PluginExtensionConnectionSummary[];
  error: string;
  setError: (message: string) => void;
  loading: boolean;
  refresh: () => Promise<void>;
};

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

export function History({
  runs,
  stateLabels,
}: {
  runs: PluginExtensionActionRun[];
  stateLabels: Record<string, string>;
}) {
  const t = useWorkbenchMessages();
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
                const receipt =
                  run.output as Partial<IntegrationReceipt> | null;
                return (
                  <tr key={run.runId}>
                    <td>{new Date(run.createdAt).toLocaleString("es-CO")}</td>
                    <td>{run.actionId}</td>
                    <td>
                      {receipt?.state
                        ? (stateLabels[receipt.state] ?? receipt.state)
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
  state: IntegrationConnectionState;
  connectorId: string;
}) {
  const t = useWorkbenchMessages();
  const [endpoint, setEndpoint] = useState(""),
    [token, setToken] = useState(""),
    [saving, setSaving] = useState(false);
  return (
    <>
      {state.loading ? (
        <p role="status">{t("Cargando conexiones…")}</p>
      ) : !state.connections.length ? (
        <p role="status">
          {t(
            "Sin conexión configurada. Registra una conexión cifrada con un destino autorizado por el administrador.",
          )}
        </p>
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
            {t("Endpoint HTTPS autorizado")}
            <input
              type="url"
              required
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </label>
          <label>
            {t("Token secreto")}
            <input
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
