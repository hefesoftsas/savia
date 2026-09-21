import { usePluginMessages } from "@savia/crm-shared/plugin-locale-react";
import { integrationMessages } from "./locales";
import { useEffect, useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  Shell,
  History,
  IntegrationStatus,
  loadAll,
} from "@savia/insurance-workbench/integrations";
import { useIntegration } from "@savia/insurance-communications/ui";
import {
  saveIntegrationRecord,
  type IntegrationRecord,
} from "@savia/insurance-communications/persistence";
import { stateLabels } from "@savia/insurance-communications/domain";
import type { Receipt } from "@savia/insurance-communications/gateway";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { operations, createIntent, parseIntent } from "./domain";
export function CarriersScreen({ savia }: { savia: PluginApi }) {
 const t = usePluginMessages(integrationMessages);
  const state = useIntegration(savia),
    [operation, setOperation] = useState("policy-status"),
    [policy, setPolicy] = useState(""),
    [carrier, setCarrier] = useState(""),
    [connection, setConnection] = useState(""),
    [key, setKey] = useState<string>(crypto.randomUUID()),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [saved, setSaved] = useState<IntegrationRecord[]>([]),
    [selected, setSelected] = useState<IntegrationRecord | null>(null),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    try {
      setSaved(
        (await loadAll(savia, requirement.object.name)) as IntegrationRecord[],
      );
    } catch {
      state.setError("No se pudieron cargar las solicitudes guardadas.");
    }
  };
  useEffect(() => {
    void refresh();
  }, [savia]);
  async function execute(statusOnly = false) {
    setBusy(true);
    try {
      const intent = selected
        ? parseIntent(selected.payload)
        : createIntent(
            operation,
            policy,
            carrier,
            connection || state.connections[0]?.connectionId || "",
            key,
          );
      let record = selected;
      if (!record) {
        record = await saveIntegrationRecord(savia, requirement.object.name, {
          title: `${intent.carrier} · ${intent.policy}`,
          payload: JSON.stringify(intent),
          stage: "prepared",
        });
        setSelected(record);
      }
      const current = await savia.collections
        .collection<IntegrationRecord>(requirement.object.name)
        .get(record.id);
      if (
        current._version !== record._version ||
        current.payload !== record.payload
      )
        throw Error("La solicitud cambió. Recárgala antes de ejecutar.");
      // Intent and stable provider key are persisted before any external mutation.
      const result = await state.execute(
        statusOnly ? "policy-status" : intent.operation,
        {
          policy: intent.policy,
          carrier: intent.carrier,
          operationKey: intent.operationKey,
        },
        statusOnly
          ? `${intent.operationKey}-status-${Date.now()}`
          : intent.operationKey,
        intent.connectionId,
      );
      setReceipt(result);
      const updated = await saveIntegrationRecord(
        savia,
        requirement.object.name,
        { stage: result?.state ?? "unknown" },
        record,
      );
      setSelected(updated);
      await refresh();
    } catch (error) {
      state.setError(
        error instanceof Error
          ? error.message
          : "No se confirmó la operación. Conserva la solicitud y consulta su estado.",
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell
      title={t("Aseguradoras")}
      description={t("Guarda cada solicitud antes de enviarla y recupera su referencia para consultar o reintentar con seguridad.")}
    >
      <IntegrationStatus state={state} connectorId={`${manifest.id}.gateway`} />
      <label>
        {t("Solicitudes guardadas")}<select
          value={selected?.id ?? ""}
          disabled={busy}
          onChange={(event) => {
            const row = saved.find((item) => item.id === event.target.value);
            if (!row) {
              setSelected(null);
              setReceipt(null);
              setKey(crypto.randomUUID());
              return;
            }
            try {
              const intent = parseIntent(row.payload);
              setSelected(row);
              setOperation(intent.operation);
              setPolicy(intent.policy);
              setCarrier(intent.carrier);
              setConnection(intent.connectionId);
              setKey(intent.operationKey);
              setReceipt(null);
            } catch (error) {
              state.setError(String(error));
            }
          }}
        >
          <option value="">{t("Nueva solicitud")}</option>
          {saved.map((row) => (
            <option key={row.id} value={row.id}>
              {String(row.title)} · {String(row.stage)}
            </option>
          ))}
        </select>
      </label>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          await execute();
        }}
      >
        <label>
          {t("Conexión")}<select
            disabled={busy || !!selected}
            value={connection}
            onChange={(event) => setConnection(event.target.value)}
          >
            <option value="">{t("Primera conexión disponible")}</option>
            {state.connections.map((item) => (
              <option key={item.connectionId}>{item.connectionId}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Operación")}<select
            disabled={busy || !!selected}
            value={operation}
            onChange={(event) => setOperation(event.target.value)}
          >
            {operations.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Aseguradora / código del proveedor")}<input
            required
            disabled={busy || !!selected}
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
          />
        </label>
        <label>
          {t("Referencia de póliza o solicitud")}<input
            required
            disabled={busy || !!selected}
            value={policy}
            onChange={(event) => setPolicy(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy || state.busy || !state.connections.length}
        >
          {busy
            ? t("Procesando…")
            : selected
              ? t("Reintentar con la misma referencia")
              : t("Guardar y ejecutar")}
        </button>
        <button
          type="button"
          disabled={busy || !selected || !state.connections.length}
          onClick={() => execute(true)}
        >
          {t("Consultar estado guardado")}</button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setSelected(null);
            setKey(crypto.randomUUID());
            setReceipt(null);
            setPolicy("");
          }}
        >
          {t("Nueva solicitud")}</button>
      </form>
      <p>
        {t("Una solicitud aceptada no confirma emisión. Ante un resultado desconocido, recupera la solicitud guardada y consulta su estado antes de reintentar.")}</p>
      {receipt && (
        <p role="status">
          {stateLabels[receipt.state]} · {receipt.reference}{" "}
          {receipt.documentUrl && (
            <a href={receipt.documentUrl} target="_blank" rel="noreferrer">
              {t("Abrir documento del proveedor")}</a>
          )}
        </p>
      )}
      <p>{t("Referencia de operación:")}{key}</p>
      <button
        onClick={() => {
          void state.refresh();
          void refresh();
        }}
      >
        {t("Actualizar historial")}</button>
      <History runs={state.runs} stateLabels={stateLabels} />
    </Shell>
  );
}
export const screens = [
  {
    id: manifest.id,
    extensionId: manifest.id,
    object: requirement.object.name,
    view: "records",
    Screen: CarriersScreen,
  },
] as const;
