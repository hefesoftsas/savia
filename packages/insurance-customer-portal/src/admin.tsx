import { usePluginMessages } from "@savia/crm-shared/plugin-locale-react";
import { integrationMessages } from "./locales";
import { useEffect, useState } from "react";
import type { PluginApi, PluginFile } from "@savia/crm-shared/plugin-api";
import {
  loadRecords,
  money,
  dateLabel,
  text,
  errorMessage,
  type WorkRecord,
} from "@savia/insurance-workbench/data";
import { manifest } from "./manifest";
import { requirement } from "./object";
import {
  blueprint,
  verifyAccess,
  requestInput,
  collection,
  statusLabels,
} from "./domain";
import "@savia/insurance-workbench/workbench.css";
export function Screen({ savia }: { savia: PluginApi }) {
 const t = usePluginMessages(integrationMessages);
  const [customer, setCustomer] = useState(""),
    [policies, setPolicies] = useState<WorkRecord[]>([]),
    [requests, setRequests] = useState<WorkRecord[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<WorkRecord | null>(null),
    [files, setFiles] = useState<PluginFile[]>([]),
    [subject, setSubject] = useState(""),
    [kind, setKind] = useState("query"),
    [details, setDetails] = useState(""),
    [policy, setPolicy] = useState(""),
    [setupId, setSetupId] = useState("");
  async function access() {
    const id = verifyAccess(await savia.access?.effective());
    return id;
  }
  async function refresh() {
    setBusy(true);
    setError("");
    setCustomer("");
    setPolicies([]);
    setRequests([]);
    setSelected(null);
    setFiles([]);
    try {
      const id = await access();
      const [p, r] = await Promise.all([
        loadRecords(savia, "polizas"),
        loadRecords(savia, collection),
      ]);
      setPolicies(p);
      setRequests(r);
      setCustomer(id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [savia]);
  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if ((await access()) !== customer)
        throw new Error("Tu acceso cambió. Actualiza el portal.");
      await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function openRequest(record: WorkRecord) {
    await act(async () => {
      setSelected(record);
      setFiles([]);
      if (savia.files) setFiles(await savia.files.list(collection, record.id));
    });
  }
  async function download(file: PluginFile) {
    await act(async () => {
      if (!savia.files) throw new Error("Los archivos no están disponibles.");
      const blob = await savia.files.download(file.id),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function exportBlueprint() {
    try {
      const grants = blueprint(setupId),
        url = URL.createObjectURL(
          new Blob([JSON.stringify({ customerId: setupId, grants }, null, 2)], {
            type: "application/json",
          }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "permisos-portal-cliente.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <main className="iw-finance">
      <header>
        <div>
          <h1>{t("Tu portal de seguros")}</h1>
          <p>
            {t("Consulta tus pólizas y conversa con tu asesor a través de solicitudes con seguimiento.")}</p>
        </div>
        <button disabled={busy} onClick={() => void refresh()}>
          {t("Actualizar")}</button>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">{t("Cargando…")}</p>}
      {!customer && !busy ? (
        <section>
          <h2>{t("Acceso pendiente de configuración")}</h2>
          <p>
            {t("Este portal necesita una cuenta autenticada con permisos exclusivos para un cliente. Tu asesor debe revisar la asignación en Roles y permisos.")}</p>
          <details>
            <summary>{t("Guía para quien administra el acceso")}</summary>
            <p>
              {t("Descarga una propuesta validada de permisos y aplícala en Roles y permisos. No concede acceso por sí sola. Usa una cuenta de cliente sin rol administrador ni permisos adicionales. Consulta la guía de instalación del portal antes de asignar el rol.")}</p>
            <div className="iw-controls">
              <label>
                {t("Identificador exacto del cliente")}<input
                  value={setupId}
                  onChange={(e) => setSetupId(e.target.value)}
                  maxLength={200}
                />
              </label>
              <button onClick={exportBlueprint}>
                {t("Descargar propuesta de permisos")}</button>
            </div>
          </details>
        </section>
      ) : (
        customer && (
          <>
            <section>
              <h2>{t("Mis pólizas")}</h2>
              {!policies.length ? (
                <p>
                  {t("No tienes pólizas disponibles en este portal. Puedes enviar una consulta a tu asesor.")}</p>
              ) : (
                <div className="iw-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Póliza")}</th>
                        <th>{t("Estado")}</th>
                        <th>{t("Inicio")}</th>
                        <th>{t("Vencimiento")}</th>
                        <th>{t("Prima")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {policies.map((p) => (
                        <tr key={p.id}>
                          <td>{text(p.name) || p.id}</td>
                          <td>{text(p.estado) || t("Sin estado")}</td>
                          <td>{dateLabel(p.inicio)}</td>
                          <td>{dateLabel(p.fin)}</td>
                          <td>{money(p.prima)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section>
              <h2>{t("Nueva solicitud")}</h2>
              <p>
                {t("Para un siniestro, este formulario envía un aviso a tu asesor. No confirma cobertura ni reemplaza los canales de atención urgente de tu aseguradora.")}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    const input = requestInput(customer, {
                      name: subject,
                      kind,
                      details,
                      policy_reference: policy,
                    });
                    const created = await savia.collections
                      .collection<WorkRecord>(collection)
                      .create(input);
                    setRequests([created, ...requests]);
                    setSubject("");
                    setDetails("");
                    setPolicy("");
                    setSelected(created);
                    setFiles([]);
                    setNotice(
                      "Solicitud recibida. Puedes adjuntar documentos en el detalle.",
                    );
                  });
                }}
              >
                <div className="iw-controls">
                  <label>
                    {t("Asunto")}<input
                      required
                      minLength={3}
                      maxLength={160}
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </label>
                  <label>
                    {t("Tipo")}<select
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="query">{t("Consulta")}</option>
                      <option value="certificate">{t("Solicitar certificado")}</option>
                      <option value="data_update">{t("Actualizar mis datos")}</option>
                      <option value="complaint">{t("Reclamo de servicio")}</option>
                      <option value="claim">{t("Aviso de siniestro")}</option>
                    </select>
                  </label>
                  <label>
                    {t("Póliza relacionada")}<select
                      value={policy}
                      onChange={(e) => setPolicy(e.target.value)}
                    >
                      <option value="">{t("Sin póliza relacionada")}</option>
                      {policies.map((p) => (
                        <option key={p.id} value={p.id}>
                          {text(p.name) || p.id}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  {t("Cuéntanos qué necesitas")}<textarea
                    required
                    minLength={10}
                    maxLength={6000}
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                  />
                </label>
                <button className="iw-primary" disabled={busy} type="submit">
                  {t("Enviar solicitud")}</button>
              </form>
            </section>
            <section>
              <h2>{t("Mis solicitudes")}</h2>
              {!requests.length ? (
                <p>{t("Aún no has enviado solicitudes.")}</p>
              ) : (
                <div className="iw-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Asunto")}</th>
                        <th>{t("Estado")}</th>
                        <th>{t("Respuesta")}</th>
                        <th>{t("Detalle")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((r) => (
                        <tr key={r.id}>
                          <td>{text(r.name)}</td>
                          <td>
                            {statusLabels[text(r.stage)] ?? t("En revisión")}
                          </td>
                          <td>{dateLabel(r.response_date)}</td>
                          <td>
                            <button
                              disabled={busy}
                              onClick={() => void openRequest(r)}
                            >
                              {t("Ver")}{text(r.name)}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {selected && (
              <section aria-label={t("Detalle de la solicitud")}>
                <header>
                  <h2>{text(selected.name)}</h2>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setSelected(null);
                      setFiles([]);
                    }}
                  >
                    {t("Cerrar detalle")}</button>
                </header>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {text(selected.details)}
                </p>
                <h3>{t("Respuesta de tu asesor")}</h3>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {text(selected.response) ||
                    t("Tu solicitud está pendiente de respuesta.")}
                </p>
                <h3>{t("Documentos")}</h3>
                {savia.files ? (
                  <>
                    <p>
                      {t("Adjunta documentos de esta solicitud. Máximo 5 MB por archivo y 50 documentos por solicitud.")}</p>
                    <label>
                      {t("Subir documento")}<input
                        type="file"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file)
                            void act(async () => {
                              if (!file.size || file.size > 5 * 1024 * 1024)
                                throw new Error(
                                  "El archivo debe pesar entre 1 byte y 5 MB.",
                                );
                              await savia.files!.upload(
                                collection,
                                selected.id,
                                file,
                              );
                              setFiles(
                                await savia.files!.list(
                                  collection,
                                  selected.id,
                                ),
                              );
                              setNotice("Documento adjuntado.");
                            });
                        }}
                      />
                    </label>
                    {files.length ? (
                      <ul>
                        {files.map((file) => (
                          <li key={file.id}>
                            <button
                              disabled={busy}
                              onClick={() => void download(file)}
                            >
                              {t("Descargar")}{file.name}
                            </button>{" "}
                            · {Math.ceil(file.size / 1024)} {t("KB")}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>{t("No hay documentos adjuntos.")}</p>
                    )}
                  </>
                ) : (
                  <p>
                    {t("La carga de documentos no está disponible en esta instalación.")}</p>
                )}
              </section>
            )}
          </>
        )
      )}
    </main>
  );
}
export const screens = [
  {
    id: `${manifest.id}.worklist`,
    extensionId: manifest.id,
    object: requirement.object.name,
    view: "records",
    Screen,
  },
];
