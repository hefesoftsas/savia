import { usePluginLocale } from "@savia/crm-shared/plugin-locale-react";
import { useMessages } from "./localization";
import { useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { text, type WorkRecord } from "@savia/insurance-workbench";
export function ResponseAction({
  savia,
  record,
}: {
  savia: PluginApi;
  record: WorkRecord;
}) {
const locale = usePluginLocale();
const t = useMessages();

  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="iw-tools" aria-label={t("Preparar respuesta")}>
       <h2>{t("Preparar respuesta")} </h2>
       <div className="iw-tool-fields">
         <label>
          {t("Correo del destinatario")} <input
            type="email"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
          />
         </label>
       </div>
       <button
        type="button"
        disabled={busy || !String(record.outcome ?? "").trim()}
        onClick={async () => {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
            setMessage("Indica un correo válido.");
            return;
          }
          setBusy(true);
          try {
            await savia.collections
              .collection("insurance_communications")
              .create({
                title: `Respuesta a ${text(record.name)}`,
                stage: "draft",
                payload: JSON.stringify({
                  recipient,
                  body: text(record.outcome),
                  consent: false,
                  suppressed: false,
                  operationKey: `service:${record.id}:response`,
                  source: { collection: "insurance_service", id: record.id },
                  clientId: record.customer_id,
                }),
              });
            setMessage(
              "Borrador creado en Comunicaciones. Verifica el consentimiento antes de enviar; el registro conserva su estado actual.",
            );
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : t("No se pudo preparar la respuesta."),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Preparar respuesta por correo")} </button>
       <p role="status">{t(message)}</p>
     </section>
  );
}
