import { useMessages } from "./localization";
import { useEffect, useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  loadRecords,
  today,
  type WorkRecord,
} from "@savia/insurance-workbench/data";
import { checklist, validateTemplate, type ChecklistTemplate } from "./domain";
export function Templates({
  savia,
  onSaved,
}: {
  savia: PluginApi;
  onSaved: () => void;
}) {
const t = useMessages();

  const [name, setName] = useState("Vinculación de cliente"),
    [requirements, setRequirements] = useState(
      "Identificación\nAutorización de tratamiento de datos",
    );
  const [customers, setCustomers] = useState<WorkRecord[]>([]),
    [customerId, setCustomerId] = useState(""),
    [owner, setOwner] = useState(""),
    [due, setDue] = useState(today());
  const [version, setVersion] = useState<number | null>(null),
    [saved, setSaved] = useState<ChecklistTemplate | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof checklist> | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    Promise.all([
      savia.settings.get<{ template?: ChecklistTemplate }>(),
      loadRecords(savia, "clientes"),
    ])
      .then(([settings, records]) => {
        if (!active) return;
        setVersion(settings.version);
        setCustomers(records);
        if (settings.value.template) {
          setSaved(settings.value.template);
          setName(settings.value.template.name);
          setRequirements(settings.value.template.requirements.join("\n"));
        }
      })
      .catch((error) => {
        if (active) setMessage(String(error));
      });
    return () => {
      active = false;
    };
  }, [savia]);
  const template = () => ({
    name: name.trim(),
    requirements: requirements
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  });
  return (
    <section
      className="iw-workbench iw-tools"
      aria-label={t("Plantilla de expediente")}
    >
       <h2>{t("Preparar expediente")} </h2>
       <p>
        {t("Define los requisitos de tu operación. La plantilla no determina obligaciones legales.")} </p>
       <fieldset className="iw-tool-fields">
         <label>
          {t("Nombre de plantilla")} <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setPreview(null);
            }}
          />
         </label>
         <label>
          {t("Requisitos, uno por línea")} <textarea
            value={requirements}
            onChange={(event) => {
              setRequirements(event.target.value);
              setPreview(null);
            }}
          />
         </label>
       </fieldset>
       <button
        type="button"
        disabled={busy || version === null}
        onClick={async () => {
          setBusy(true);
          try {
            const value = template();
            validateTemplate(value);
            const result = await savia.settings.replace(
              { template: value },
              version!,
            );
            setSaved(value);
            setVersion(result.version);
            setPreview(null);
            setMessage("Plantilla guardada.");
          } catch (error) {
            setMessage(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Guardar plantilla")} </button>
       <h2>{t("Asignar requisitos al cliente")} </h2>
       <fieldset className="iw-tool-fields">
         <label>
          {t("Cliente")} <select
            value={customerId}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setPreview(null);
            }}
          >
             <option value="">{t("Selecciona un cliente")} </option>
             {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                 {String(customer.name)}
               </option>
            ))}
           </select>
         </label>
         <label>
          {t("Responsable")} <input
            value={owner}
            onChange={(event) => {
              setOwner(event.target.value);
              setPreview(null);
            }}
          />
         </label>
         <label>
          {t("Compromiso")} <input
            type="date"
            value={due}
            onChange={(event) => {
              setDue(event.target.value);
              setPreview(null);
            }}
          />
         </label>
       </fieldset>
       <button
        type="button"
        disabled={busy || !saved}
        onClick={async () => {
          setBusy(true);
          try {
            if (JSON.stringify(template()) !== JSON.stringify(saved))
              throw new Error(
                t("Guarda los cambios de la plantilla antes de preparar el expediente."),
              );
            const customer = customers.find((row) => row.id === customerId);
            const rows = checklist(
              saved!,
              version!,
              { id: customerId, name: String(customer?.name ?? "") },
              owner,
              due,
            );
            const existing = await loadRecords(savia, "insurance_compliance");
            setPreview(
              rows.filter(
                (row) =>
                  !existing.some(
                    (record) => record.dossier_key === row.dossier_key,
                  ),
              ),
            );
            setMessage("");
          } catch (error) {
            setMessage(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Revisar requisitos nuevos")} </button>
       {preview && (
        <>
           <ul>
             {preview.map((row) => (
              <li key={row.dossier_key}>
                 {row.name} · {row.customer} · {row.due_date}
               </li>
            ))}
           </ul>
           <p>
             {preview.length} {t("requisitos nuevos; los existentes se conservan.")} </p>
           <button
            type="button"
            disabled={busy || !preview.length}
            onClick={async () => {
              setBusy(true);
              let created = 0;
              try {
                const settings = await savia.settings.get();
                if (settings.version !== version)
                  throw new Error(
                    t("La plantilla cambió; recarga y revisa el expediente."),
                  );
                await savia.collections.collection("clientes").get(customerId);
                for (const row of preview) {
                  await savia.collections
                    .collection("insurance_compliance")
                    .create(row);
                  created++;
                }
                setMessage(`${created} requisitos creados.`);
                setPreview(null);
                onSaved();
              } catch (error) {
                setMessage(
                  `${created} requisitos creados. Revisa otra vez antes de reintentar. ${String(error)}`,
                );
                setPreview(null);
                onSaved();
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Crear expediente revisado")} </button>
         </>
      )}
       <p role="status">{t(message)}</p>
     </section>
  );
}
