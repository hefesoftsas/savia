import { usePluginMessages } from "@savia/crm-shared/plugin-locale-react";
import { integrationMessages } from "./locales";
import { useEffect, useState } from "react";
import type { PluginApi, PluginFile } from "@savia/crm-shared/plugin-api";
import {
  Shell,
  History,
  useIntegration,
  IntegrationStatus,
  loadAll,
} from "@savia/insurance-communications/ui";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { interpolate, templateVariables } from "./domain";
import {
  persistDocument,
  signaturePatch,
  resolveArtifact,
  loadDocumentFiles,
  type DocumentRecord,
} from "./workflow";
export function DocumentGenerationScreen({ savia }: { savia: PluginApi }) {
 const t = usePluginMessages(integrationMessages);
  const integration = useIntegration(savia),
    [records, setRecords] = useState<DocumentRecord[]>([]),
    [selected, setSelected] = useState<DocumentRecord | null>(null),
    [name, setName] = useState(""),
    [template, setTemplate] = useState("Estimado/a {{nombre}}:\n\n"),
    [variables, setVariables] = useState<Record<string, string>>({}),
    [recipient, setRecipient] = useState(""),
    [files, setFiles] = useState<PluginFile[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const refresh = async () => {
    try {
      setRecords(
        (await loadAll(savia, requirement.object.name)) as DocumentRecord[],
      );
    } catch {
      integration.setError(
        "No se pudieron cargar los documentos y plantillas. Vuelve a intentar.",
      );
    }
  };
  useEffect(() => {
    void refresh();
  }, [savia]);
  useEffect(() => {
    setFiles([]);
    if (selected?.kind === "document")
      return loadDocumentFiles(savia, selected.id, setFiles, () =>
        integration.setError("No se pudieron cargar los archivos asociados."),
      );
  }, [selected?.id, selected?._version, savia]);
  const fields =
    selected?.kind === "document" ? [] : templateVariables(template);
  let preview = "",
    valid = true;
  try {
    preview =
      selected?.kind === "document"
        ? template
        : interpolate(template, variables);
    if (fields.some((field) => !variables[field]?.trim())) valid = false;
  } catch {
    valid = false;
    preview = "Completa las variables para ver el documento.";
  }
  const collection = savia.collections.collection<DocumentRecord>(
    requirement.object.name,
  );
  function choose(record: DocumentRecord) {
    setFiles([]);
    setSelected(record);
    setName(String(record.name ?? ""));
    setTemplate(String(record.template ?? ""));
    setVariables({});
    setRecipient(String(record.signature_recipient ?? ""));
    setNotice("");
  }
  async function signature(action: "request-signature" | "signature-status") {
    if (!selected || !files.length) return;
    setBusy(true);
    try {
      let current = await collection.get(selected.id);
      if (action === "request-signature") {
        if (
          current.signature_recipient &&
          current.signature_recipient !== recipient
        )
          throw Error(
            "La solicitud ya tiene otro firmante. Genera un nuevo documento para cambiarlo.",
          );
        current = await collection.update(
          current.id,
          { signature_recipient: recipient },
          { version: current._version },
        );
      }
      const artifact = await resolveArtifact(savia, current);
      const receipt = await integration.execute(
        action,
        {
          documentId: current.id,
          fileId: artifact.id,
          fileVersion: artifact.version,
          recipient: current.signature_recipient ?? recipient,
          reference: current.signature_reference,
          operationKey: `${current.id}-signature`,
        },
        action === "request-signature"
          ? `${current.id}-signature`
          : `${current.id}-status-${Date.now()}`,
      );
      if (receipt) {
        const latest = await collection.get(current.id);
        const updated = await collection.update(
          current.id,
          signaturePatch(receipt),
          { version: latest._version },
        );
        setSelected(updated);
        setNotice(
          updated.stage === "signed"
            ? "Fecha y evidencia de firma recibidas. Revisa el respaldo del proveedor."
            : "Respuesta recibida. Aún no hay evidencia completa de firma.",
        );
        await refresh();
      }
    } catch (error) {
      integration.setError(
        error instanceof Error
          ? error.message
          : "No se pudo registrar la firma.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function download(file: PluginFile, print = false) {
    if (!savia.files) return;
    setBusy(true);
    try {
      const blob = await savia.files.download(file.id);
      const url = URL.createObjectURL(blob);
      if (print) {
        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.setAttribute("sandbox", "allow-same-origin allow-modals");
        frame.src = url;
        frame.onload = () => {
          frame.contentWindow?.print();
          setTimeout(() => {
            frame.remove();
            URL.revokeObjectURL(url);
          }, 60000);
        };
        document.body.append(frame);
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      integration.setError(
        "No se pudo descargar el archivo. Revisa tus permisos e intenta nuevamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell
      title={t("Documentos y firma")}
      description={t("Prepara plantillas, genera archivos verificables y conserva la evidencia de firma del proveedor.")}
    >
      <IntegrationStatus
        state={integration}
        connectorId={`${manifest.id}.gateway`}
      />
      <div className="integration-actions">
        <label>
          {t("Plantillas y documentos")}<select
            value={selected?.id ?? ""}
            disabled={busy || integration.busy}
            onChange={(e) => {
              const row = records.find((r) => r.id === e.target.value);
              if (row) choose(row);
            }}
          >
            <option value="">{t("Selecciona un registro")}</option>
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {String(r.name)} ·{" "}
                {r.kind === "template" ? t("Plantilla") : t("Documento")}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || integration.busy}
          onClick={() => {
            setSelected(null);
            setName("");
            setTemplate("Estimado/a {{nombre}}:\n\n");
            setVariables({});
            setFiles([]);
            setNotice("");
          }}
        >
          {t("Nueva plantilla")}</button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const input = { name, template, kind: "template", stage: "draft" };
            const record =
              selected?.kind === "template"
                ? await collection.update(selected.id, input, {
                    version: selected._version,
                  })
                : await collection.create(input);
            setSelected(record);
            setNotice("Plantilla guardada.");
            await refresh();
          } catch {
            integration.setError(
              "No se pudo guardar la plantilla. Si otro usuario la cambió, vuelve a cargarla.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="integration-wide">
          {t("Nombre del documento")}<input
            required
            maxLength={160}
            value={name}
            disabled={selected?.kind === "document"}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="integration-wide">
          {t("Contenido de la plantilla")}<textarea
            required
            maxLength={10000}
            value={template}
            disabled={selected?.kind === "document"}
            onChange={(e) => {
              setTemplate(e.target.value);
              setNotice("");
            }}
          />
        </label>
        <p className="integration-wide">
          {t("Añade variables como")}{t("{{nombre}}")} o {t("{{numero_poliza}}")}{t(". Los documentos generados conservan una copia fija del contenido.")}</p>
        {fields.map((field) => (
          <label key={field}>
            {field.replaceAll("_", " ")}
            <input
              value={variables[field] ?? ""}
              onChange={(e) =>
                setVariables({ ...variables, [field]: e.target.value })
              }
            />
          </label>
        ))}
        <div className="integration-actions integration-wide">
          {selected?.kind !== "document" ? (
            <button type="submit" disabled={busy}>
              {t("Guardar plantilla")}</button>
          ) : null}
          <button
            type="button"
            disabled={
              busy ||
              !valid ||
              !name.trim() ||
              !preview.trim() ||
              !savia.files ||
              selected?.stage === "generated" ||
              selected?.stage === "requested" ||
              selected?.stage === "signed"
            }
            onClick={async () => {
              setBusy(true);
              try {
                const record = await persistDocument(
                  savia,
                  { name, body: preview },
                  selected?.kind === "document" ? selected : undefined,
                );
                setSelected(record);
                setTemplate(String(record.template));
                setVariables({});
                setNotice("Documento y archivo guardados.");
                await refresh();
              } catch {
                integration.setError(
                  "No se completó la generación. Revisa los documentos guardados: si existe un borrador, selecciónalo para reintentar sin crear otro registro.",
                );
                await refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            {selected?.kind === "document"
              ? t("Reintentar archivo")
              : t("Generar y guardar documento")}
          </button>
        </div>
      </form>
      <section>
        <h2>{t("Vista previa")}</h2>
        <pre>{preview}</pre>
      </section>
      {!savia.files ? (
        <p role="status">
          {t("El entorno no dispone de almacenamiento de archivos. Puedes guardar plantillas; la generación requiere habilitarlo.")}</p>
      ) : null}
      {selected?.kind === "document" ? (
        <section>
          <h2>{t("Archivos del documento")}</h2>
          {files.length ? (
            files.map((file) => (
              <div key={file.id} className="integration-actions">
                <span>
                  {file.name} {t("· versión")}{file.version}
                </span>
                <button disabled={busy} onClick={() => download(file)}>
                  {t("Descargar")}</button>
                <button disabled={busy} onClick={() => download(file, true)}>
                  {t("Imprimir / guardar PDF")}</button>
              </div>
            ))
          ) : (
            <p>
              {t("Sin archivo confirmado. Reintenta la generación si el documento sigue en borrador.")}</p>
          )}
          <h2>{t("Firma electrónica")}</h2>
          <label>
            {t("Correo del firmante")}<input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </label>
          <div className="integration-actions">
            <button
              disabled={
                busy ||
                integration.busy ||
                !files.length ||
                !integration.connections.length ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ||
                selected.stage === "signed"
              }
              onClick={() => signature("request-signature")}
            >
              {t("Solicitar firma")}</button>
            <button
              disabled={
                busy ||
                integration.busy ||
                !files.length ||
                !integration.connections.length
              }
              onClick={() => signature("signature-status")}
            >
              {t("Consultar firma")}</button>
          </div>
          {selected.stage === "signed" &&
          selected.signed_at &&
          selected.evidence_url ? (
            <p>
              {t("Fecha informada:")}{String(selected.signed_at)} ·{" "}
              <a
                href={String(selected.evidence_url)}
                target="_blank"
                rel="noreferrer"
              >
                {t("Revisar evidencia de firma")}</a>
            </p>
          ) : (
            <p>
              {t("La aceptación o entrega del documento no acredita por sí sola una firma.")}</p>
          )}
        </section>
      ) : null}
      <p role="status">{notice}</p>
      <History runs={integration.runs} />
    </Shell>
  );
}
export const screens = [
  {
    id: manifest.id,
    extensionId: manifest.id,
    object: requirement.object.name,
    view: "records",
    Screen: DocumentGenerationScreen,
  },
] as const;
