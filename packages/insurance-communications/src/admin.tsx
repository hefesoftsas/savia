import { usePluginMessages } from "@savia/studio-shared/plugin-locale-react";
import { integrationMessages } from "./locales";
import { useEffect, useState } from "react";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { saveIntegrationRecord } from "./persistence";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { renderTemplate, stateLabels, newMessage } from "./domain";
import {
  Shell,
  History,
  IntegrationStatus,
  loadAll,
} from "@savia/insurance-workbench/integrations";
import { useIntegration } from "./ui";
export function CommunicationsScreen({ savia }: { savia: PluginApi }) {
 const t = usePluginMessages(integrationMessages);
  const state = useIntegration(savia);
  const [recipient, setRecipient] = useState(""),
    [name, setName] = useState(""),
    [template, setTemplate] = useState(
      "Hola {{nombre}}, te contactamos sobre tu solicitud.",
    ),
    [consent, setConsent] = useState(false),
    [suppressed, setSuppressed] = useState(false),
    [key, setKey] = useState(crypto.randomUUID()),
    [notice, setNotice] = useState(""),
    [drafts, setDrafts] = useState<Record<string, unknown>[]>([]),
    [draftId, setDraftId] = useState(""),
    [draftVersion, setDraftVersion] = useState<number | undefined>(),
    [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const refreshDrafts = () =>
    loadAll(savia, requirement.object.name)
      .then(setDrafts)
      .catch(() => state.setError("No se pudieron cargar los borradores."));
  useEffect(() => {
    void refreshDrafts();
  }, [savia]);
  let preview = "",
    valid = true;
  try {
    preview = renderTemplate(template, { nombre: name });
  } catch (error) {
    preview = String((error as Error).message);
    valid = false;
  }
  const payload = {
    ...metadata,
    recipient,
    body: preview,
    consent,
    suppressed,
    operationKey: key,
  };
  function resetMessage() {
    const fresh = newMessage();
    setRecipient(fresh.recipient);
    setName(fresh.name);
    setTemplate(fresh.template);
    setConsent(fresh.consent);
    setSuppressed(fresh.suppressed);
    setMetadata(fresh.metadata);
    setDraftId("");
    setDraftVersion(undefined);
    setKey(crypto.randomUUID());
    setNotice("");
  }
  async function save() {
    try {
      const input = {
        title: recipient || "Borrador",
        payload: JSON.stringify(payload),
        stage: "draft",
      };
      const record = await saveIntegrationRecord(
        savia,
        requirement.object.name,
        input,
        draftId ? { id: draftId, _version: draftVersion } : undefined,
      );
      setDraftId(record.id);
      setDraftVersion(record._version);
      setNotice("Borrador guardado.");
      await refreshDrafts();
      return true;
    } catch {
      state.setError("No se pudo guardar el borrador.");
      return false;
    }
  }
  return (
    <Shell
      title={t("Comunicaciones")}
      description={t("Prepara mensajes, confirma el consentimiento y consulta la entrega informada por tu proveedor.")}
    >
      <IntegrationStatus state={state} connectorId={`${manifest.id}.gateway`} />
      <label>
        {t("Borradores guardados")}<select
          value={draftId}
          onChange={(e) => {
            if (!e.target.value) {
              resetMessage();
              return;
            }
            setDraftId(e.target.value);
            const row = drafts.find((d) => String(d.id) === e.target.value);
            if (row) {
              try {
                const p = JSON.parse(String(row.payload));
                setDraftVersion(
                  typeof row._version === "number" ? row._version : undefined,
                );
                setMetadata(p);
                setRecipient(p.recipient ?? "");
                setTemplate(p.body ?? "");
                setConsent(p.consent === true);
                setSuppressed(p.suppressed !== false);
                setKey(p.operationKey ?? crypto.randomUUID());
              } catch {
                state.setError("El borrador no es válido.");
              }
            }
          }}
        >
          <option value="">{t("Nuevo mensaje")}</option>
          {drafts.map((d) => (
            <option key={String(d.id)} value={String(d.id)}>
              {String(d.title)}
            </option>
          ))}
        </select>
      </label>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!(await save())) return;
          const receipt = await state.execute("send", payload, key);
          if (receipt)
            setNotice(`${stateLabels[receipt.state]} · ${receipt.reference}`);
        }}
      >
        <label>
          {t("Destinatario")}<input
            required
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              setConsent(false);
              setMetadata({});
              setKey(crypto.randomUUID());
            }}
          />
        </label>
        <label>
          {t("Nombre para la plantilla")}<input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setKey(crypto.randomUUID());
            }}
          />
        </label>
        <label className="integration-wide">
          {t("Plantilla · variable disponible:")}{t("{{nombre}}")}
          <textarea
            required
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value);
              setKey(crypto.randomUUID());
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          {t("Consentimiento vigente verificado")}</label>
        <label>
          <input
            type="checkbox"
            checked={suppressed}
            onChange={(e) => setSuppressed(e.target.checked)}
          />
          {t("Destinatario suprimido")}</label>
        <div className="integration-wide">
          <h2>{t("Vista previa")}</h2>
          <pre>{preview}</pre>
        </div>
        <div className="integration-actions integration-wide">
          <button type="button" disabled={state.busy} onClick={save}>
            {t("Guardar borrador")}</button>
          <button
            type="submit"
            disabled={
              !valid ||
              !consent ||
              suppressed ||
              state.busy ||
              !state.connections.length
            }
          >
            {state.busy ? t("Procesando…") : t("Enviar mensaje")}
          </button>
          <button type="button" onClick={resetMessage}>
            {t("Nuevo envío")}</button>
        </div>
      </form>
      <p role="status">{notice}</p>
      <p>{t("Referencia para reintentos:")}{key}</p>
      <div className="integration-actions">
        <button
          disabled={state.busy || !state.connections.length}
          onClick={() =>
            state.execute(
              "status",
              { operationKey: key },
              `${key}-status-${Date.now()}`,
            )
          }
        >
          {t("Consultar entrega")}</button>
        <button onClick={state.refresh}>{t("Actualizar historial")}</button>
      </div>
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
    Screen: CommunicationsScreen,
  },
] as const;
