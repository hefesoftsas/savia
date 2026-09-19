import { useEffect, useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  Shell,
  History,
  useIntegration,
  IntegrationStatus,
  loadAll,
} from "@savia/insurance-communications/ui";
import { renderTemplate } from "@savia/insurance-communications/domain";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { recipients } from "./domain";
export function CampaignsScreen({ savia }: { savia: PluginApi }) {
  const state = useIntegration(savia),
    [source, setSource] = useState(""),
    [sources, setSources] = useState<string[]>([]),
    [clients, setClients] = useState<Record<string, unknown>[]>([]),
    [segment, setSegment] = useState(""),
    [body, setBody] = useState("Hola {{nombre}}, tenemos novedades para ti."),
    [key, setKey] = useState(crypto.randomUUID()),
    [preview, setPreview] = useState(false),
    [notice, setNotice] = useState(""),
    [sending, setSending] = useState(false),
    [saved, setSaved] = useState<Record<string, unknown>[]>([]);
  const refreshSaved = () =>
    loadAll(savia, requirement.object.name)
      .then(setSaved)
      .catch(() =>
        state.setError("No se pudieron cargar las campañas guardadas."),
      );
  useEffect(() => {
    void refreshSaved();
    savia.collections
      .list()
      .then((rows) => setSources(rows.map((row) => row.name)))
      .catch(() =>
        state.setError("No se pudieron descubrir las colecciones autorizadas."),
      );
  }, [savia]);
  const selected = recipients(clients, segment);
  return (
    <Shell
      title="Campañas"
      description="Selecciona clientes autorizados y revisa el consentimiento antes de ejecutar cada mensaje."
    >
      <IntegrationStatus state={state} connectorId={`${manifest.id}.gateway`} />
      <label>
        Campañas guardadas
        <select
          defaultValue=""
          onChange={(e) => {
            const row = saved.find((r) => String(r.id) === e.target.value);
            if (!row) return;
            try {
              const p = JSON.parse(String(row.payload));
              setSource(p.source);
              setSegment(p.segment);
              setBody(p.body);
              setKey(p.operationKey);
              setPreview(false);
              setClients([]);
            } catch {
              state.setError("Campaña guardada no válida.");
            }
          }}
        >
          <option value="">Selecciona una preparación</option>
          {saved.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>
              {String(row.title)}
            </option>
          ))}
        </select>
      </label>
      <div className="integration-fields">
        <label>
          Colección de clientes
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPreview(false);
              setClients([]);
              setKey(crypto.randomUUID());
            }}
          >
            <option value="">Selecciona una colección</option>
            {sources.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Segmento exacto (vacío: todos)
          <input
            value={segment}
            onChange={(e) => {
              setSegment(e.target.value);
              setPreview(false);
              setKey(crypto.randomUUID());
            }}
          />
        </label>
        <label className="integration-wide">
          Mensaje · variable {"{{nombre}}"}
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setPreview(false);
              setKey(crypto.randomUUID());
            }}
          />
        </label>
      </div>
      <p>
        Solo se incluyen correos con marketing_consent = true y
        marketing_suppressed = false. Los valores ausentes se excluyen; los
        correos repetidos se deduplican.
      </p>
      <div className="integration-actions">
        <button
          disabled={!source || sending}
          onClick={async () => {
            try {
              const data = await loadAll(savia, source);
              setClients(data);
              setPreview(true);
              setNotice("");
            } catch {
              state.setError(
                "No se pudieron cargar todos los clientes. No se preparó la campaña.",
              );
            }
          }}
        >
          Preparar vista previa
        </button>
        <button
          disabled={!preview || !selected.length || sending}
          onClick={async () => {
            try {
              await savia.collections
                .collection(requirement.object.name)
                .create({
                  title: `Campaña ${segment || "general"}`,
                  payload: JSON.stringify({
                    source,
                    segment,
                    body,
                    operationKey: key,
                  }),
                  stage: "prepared",
                });
              setNotice(
                "Campaña guardada; todavía no se han enviado mensajes.",
              );
              await refreshSaved();
            } catch {
              state.setError("No se pudo guardar la campaña.");
            }
          }}
        >
          Guardar preparación
        </button>
        <button
          disabled={
            !preview || !selected.length || !state.connections.length || sending
          }
          onClick={async () => {
            setSending(true);
            let accepted = 0;
            try {
              await savia.collections
                .collection(requirement.object.name)
                .create({
                  title: `Campaña ${segment || "general"}`,
                  payload: JSON.stringify({
                    source,
                    segment,
                    body,
                    operationKey: key,
                  }),
                  stage: "executing",
                });
              await refreshSaved();
              const current = recipients(await loadAll(savia, source), segment);
              for (const client of selected) {
                if (
                  !current.some(
                    (c) => c.id === client.id && c.email === client.email,
                  )
                )
                  continue;
                const receipt = await state.execute(
                  "send",
                  {
                    clientId: client.id,
                    source,
                    recipient: client.email,
                    body: renderTemplate(body, {
                      nombre: String(client.name ?? client.nombre ?? ""),
                    }),
                    consent: true,
                    suppressed: false,
                  },
                  `${key}-${client.id}`,
                );
                if (!receipt) break;
                accepted++;
              }
              setNotice(
                `${accepted} respuestas registradas. Revisa el historial para distinguir aceptación y entrega.`,
              );
            } catch {
              state.setError(
                "Se detuvo la campaña. Revisa el historial antes de continuar.",
              );
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? "Ejecutando…" : `Ejecutar ${selected.length} mensajes`}
        </button>
      </div>
      {preview ? (
        <section>
          <h2>Destinatarios elegibles · {selected.length}</h2>
          <p>
            {clients.length - selected.length} registros excluidos por segmento,
            consentimiento, supresión, correo inválido o duplicado.
          </p>
          {selected.map((c) => (
            <article key={String(c.id)}>
              <strong>{String(c.email)}</strong>
              <pre>
                {(() => {
                  try {
                    return renderTemplate(body, {
                      nombre: String(c.name ?? c.nombre ?? ""),
                    });
                  } catch {
                    return "Revisa las variables de la plantilla.";
                  }
                })()}
              </pre>
            </article>
          ))}
        </section>
      ) : null}
      <p role="status">{notice}</p>
      <History runs={state.runs} />
    </Shell>
  );
}
export const screens = [
  {
    id: manifest.id,
    extensionId: manifest.id,
    object: requirement.object.name,
    view: "records",
    Screen: CampaignsScreen,
  },
] as const;
