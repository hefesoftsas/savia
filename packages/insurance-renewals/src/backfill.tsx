import { useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { loadRecords, type WorkRecord } from "@savia/insurance-workbench/data";
import { planRenewal } from "./domain";
type Candidate = { policy: WorkRecord; values: ReturnType<typeof planRenewal> };
export async function previewRenewals(
  savia: PluginApi,
  leadDays: number,
): Promise<{ candidates: Candidate[]; skipped: number }> {
  const [policies, customers, existing] = await Promise.all([
    loadRecords(savia, "polizas"),
    loadRecords(savia, "clientes"),
    loadRecords(savia, "insurance_renewals"),
  ]);
  const candidates: Candidate[] = [];
  for (const policy of policies) {
    try {
      const customer = customers.find((record) => record.id === policy.cliente);
      const values = planRenewal(
        policy,
        String(customer?.name ?? ""),
        leadDays,
      );
      if (
        !existing.some(
          (record) =>
            record.term_key === values.term_key ||
            ((record.source_policy_id === policy.id ||
              record.term_policy_id === policy.id) &&
              String(record.expiry_date).slice(0, 10) ===
                values.expiry_date.slice(0, 10)),
        )
      )
        candidates.push({ policy, values });
    } catch {
      /* Invalid or ineligible sources are counted and never written. */
    }
  }
  return { candidates, skipped: policies.length - candidates.length };
}
export async function executeRenewals(
  savia: PluginApi,
  candidates: Candidate[],
) {
  const target = savia.collections.collection<WorkRecord>("insurance_renewals");
  const definition = await target.describe();
  if (!definition?.config?.fields?.term_key?.config?.unique)
    throw new Error(
      "Prepara primero la plantilla Póliza → renovación para garantizar claves únicas.",
    );
  let created = 0;
  for (const candidate of candidates) {
    const current = await savia.collections
      .collection<WorkRecord>("polizas")
      .get(candidate.policy.id);
    if (
      current._version === undefined ||
      current._version !== candidate.policy._version
    )
      throw new Error(
        "Una póliza cambió. Actualiza la vista previa antes de continuar.",
      );
    await target.create(candidate.values);
    created++;
  }
  return created;
}
export function Backfill({
  savia,
  onSaved,
}: {
  savia: PluginApi;
  onSaved: () => void;
}) {
  const [lead, setLead] = useState(30),
    [preview, setPreview] = useState<Awaited<
      ReturnType<typeof previewRenewals>
    > | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section
      className="iw-workbench iw-tools"
      aria-label="Renovaciones históricas"
    >
      <h2>Preparar vigencias existentes</h2>
      <p>
        Revisa las pólizas vigentes antes de crear nuevos casos de renovación.
      </p>
      <fieldset className="iw-tool-fields">
        <label>
          Días de anticipación
          <input
            type="number"
            min="0"
            max="365"
            value={lead}
            onChange={(event) => {
              setLead(Number(event.target.value));
              setPreview(null);
            }}
          />
        </label>
      </fieldset>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setPreview(await previewRenewals(savia, lead));
            setMessage("");
          } catch (error) {
            setMessage(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        Vista previa
      </button>
      {preview && (
        <>
          <p>
            {preview.candidates.length} renovaciones nuevas · {preview.skipped}{" "}
            pólizas existentes o no elegibles
          </p>
          <ul>
            {preview.candidates.map(({ values }) => (
              <li key={values.term_key}>
                {values.policy_reference} · {values.expiry_date} · contacto{" "}
                {values.next_follow_up}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy || !preview.candidates.length}
            onClick={async () => {
              setBusy(true);
              try {
                const count = await executeRenewals(savia, preview.candidates);
                setMessage(`${count} renovaciones creadas.`);
                setPreview(null);
                onSaved();
              } catch (error) {
                setMessage(
                  `La ejecución se detuvo; revisa los registros creados y genera otra vista previa. ${String(error)}`,
                );
                setPreview(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            Crear renovaciones revisadas
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
