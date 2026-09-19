import { useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { today, type WorkRecord } from "@savia/insurance-workbench";
import { reopenExpired } from "./domain";
export function RecordActions({
  savia,
  record,
  onSaved,
}: {
  savia: PluginApi;
  record: WorkRecord;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section className="iw-tools" aria-label="Acciones del caso">
      <h2>Vigencia del documento</h2>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const collection = savia.collections.collection<WorkRecord>(
              "insurance_documents",
            );
            const current = await collection.get(record.id);
            if (current._version === undefined)
              throw new Error("Recarga el registro antes de continuar.");
            await collection.update(
              current.id,
              reopenExpired(current, today()),
              { version: current._version },
            );
            onSaved();
            setMessage("Cambio guardado.");
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "No se pudo guardar.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Reabrir documento vencido
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
