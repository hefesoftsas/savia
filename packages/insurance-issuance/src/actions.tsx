import { useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { text, type WorkRecord } from "@savia/insurance-workbench";
export function DeliveryAction({
  savia,
  record,
}: {
  savia: PluginApi;
  record: WorkRecord;
}) {
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="iw-tools" aria-label="Preparar entrega">
      <h2>Preparar entrega</h2>
      <div className="iw-tool-fields">
        <label>
          Correo del destinatario
          <input
            type="email"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy || record.stage !== "issued"}
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
                title: `Entrega de póliza ${text(record.policy_reference)}`,
                stage: "draft",
                payload: JSON.stringify({
                  recipient,
                  body: `Su póliza ${text(record.policy_reference)} ha sido expedida.`,
                  consent: false,
                  suppressed: false,
                  operationKey: `issuance:${record.id}:delivery`,
                  source: { collection: "insurance_issuance", id: record.id },
                  clientId: record.customer_id,
                }),
              });
            setMessage(
              "Borrador creado en Comunicaciones. Verifica el consentimiento y adjunta la póliza antes de enviar; la entrega sigue pendiente.",
            );
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "No se pudo preparar la entrega.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Preparar entrega por correo
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
