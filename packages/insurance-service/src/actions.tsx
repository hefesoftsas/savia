import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import { useMessages } from "./localization";
import { useState } from "react";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { today, type WorkRecord } from "@savia/insurance-workbench";
import { ResponseAction } from "./response";
import { escalate } from "./domain";
export function RecordActions({
  savia,
  record,
  onSaved,
}: {
  savia: PluginApi;
  record: WorkRecord;
  onSaved: () => void;
}) {
const locale = usePluginLocale();
const t = useMessages();

  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section className="iw-tools" aria-label={t("Acciones del caso")}>
       <h2>{t("Escalamiento")} </h2>
       <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const collection =
              savia.collections.collection<WorkRecord>("insurance_service");
            const current = await collection.get(record.id);
            if (current._version === undefined)
              throw new Error(t("Recarga el registro antes de continuar."));
            await collection.update(current.id, escalate(current, today()), {
              version: current._version,
            });
            onSaved();
            setMessage("Cambio guardado.");
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : t("No se pudo guardar."),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Escalar al responsable")} </button>
       <p role="status">{t(message)}</p>
       <ResponseAction savia={savia} record={record} />
     </section>
  );
}
