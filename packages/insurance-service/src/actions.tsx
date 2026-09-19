import { useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
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
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section className="iw-tools" aria-label="Acciones del caso">
      <h2>Escalamiento</h2>
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
              throw new Error("Recarga el registro antes de continuar.");
            await collection.update(current.id, escalate(current, today()), {
              version: current._version,
            });
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
        Escalar al responsable
      </button>
      <p role="status">{message}</p>
      <ResponseAction savia={savia} record={record} />
    </section>
  );
}
