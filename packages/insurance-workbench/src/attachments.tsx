import { usePluginLocale } from "@savia/crm-shared/plugin-locale-react";
import { useWorkbenchMessages } from "./localization";
import { useEffect, useId, useState } from "react";
import type { PluginApi, PluginFile } from "@savia/crm-shared/plugin-api";
import { errorMessage } from "./data";

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Attachments({
  savia,
  object,
  recordId,
}: {
  savia: PluginApi;
  object: string;
  recordId: string;
}) {
const locale = usePluginLocale();
const t = useWorkbenchMessages();

  const id = useId();
  const [files, setFiles] = useState<PluginFile[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [removeId, setRemoveId] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setFiles([]);
    setRemoveId("");
    if (!savia.files) {
      setLoading(false);
      return;
    }
    savia.files
      .list(object, recordId)
      .then((value) => {
        if (active) setFiles(value);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [savia, object, recordId, revision]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setRevision((v) => v + 1);
      setRemoveId("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  if (!savia.files) return null;
  return (
    <section className="iw-attachments" aria-labelledby={id}>
       <h3 id={id}>{t("Archivos del registro")} </h3>
       <p>{t("Adjunta los soportes de este caso. Máximo 5 MB por archivo.")} </p>
       {error && (
        <p role="alert">
           {error}{" "}
           <button type="button" onClick={() => setRevision((v) => v + 1)}>
            {t("Actualizar archivos")} </button>
         </p>
      )}
       {loading ? (
        <p role="status">{t("Cargando archivos…")} </p>
      ) : !error ? (
        <>
           {!files.length && !error && <p>{t("No hay archivos adjuntos.")} </p>}
           <ul>
             {files.map((file) => (
              <li key={file.id}>
                 <span>
                   {file.name} · {Math.ceil(file.size / 1024)} KB
                </span>
                 <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () =>
                      downloadBlob(
                        await savia.files!.download(file.id),
                        file.name,
                      ),
                    )
                  }
                >
                  {t("Descargar")} </button>
                 {removeId === file.id ? (
                  <>
                     <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() => savia.files!.remove(file.id, file.version))
                      }
                    >
                      {t("Confirmar eliminación")} </button>
                     <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRemoveId("")}
                    >
                      {t("Conservar")} </button>
                   </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRemoveId(file.id)}
                  >
                    {t("Eliminar")} </button>
                )}
               </li>
            ))}
           </ul>
         </>
      ) : null}
       <label>
        {t("Adjuntar archivo")} <input
          type="file"
          disabled={busy || loading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (!file.size || file.size > 5 * 1024 * 1024) {
              setError("Selecciona un archivo entre 1 byte y 5 MB.");
              return;
            }
            void run(() => savia.files!.upload(object, recordId, file));
          }}
        />
       </label>
       {busy && <p role="status">{t("Procesando archivo…")} </p>}
     </section>
  );
}
