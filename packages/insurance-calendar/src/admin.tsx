import { useEffect, useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  Shell,
  History,
  useIntegration,
  IntegrationStatus,
  loadAll,
} from "@savia/insurance-communications/ui";
import { saveIntegrationRecord } from "@savia/insurance-communications/persistence";
import { manifest } from "./manifest";
import { requirement } from "./object";
import {
  toICS,
  validateEvent,
  syncOperationKey,
  localToInstant,
  instantToLocal,
  type CalendarEvent,
} from "./domain";
export function CalendarScreen({ savia }: { savia: PluginApi }) {
  const state = useIntegration(savia),
    [events, setEvents] = useState<Record<string, unknown>[]>([]),
    [notice, setNotice] = useState(""),
    [recordId, setRecordId] = useState(""),
    [recordVersion, setRecordVersion] = useState<number | undefined>(),
    [savedPayload, setSavedPayload] = useState(""),
    [startLocal, setStartLocal] = useState(""),
    [endLocal, setEndLocal] = useState(""),
    [timeError, setTimeError] = useState(""),
    [event, setEvent] = useState<CalendarEvent>({
      id: crypto.randomUUID(),
      title: "",
      start: "",
      end: "",
      timeZone: "America/Bogota",
      description: "",
    });
  const refresh = () =>
    loadAll(savia, requirement.object.name)
      .then(setEvents)
      .catch(() => state.setError("No se pudo cargar la agenda."));
  useEffect(() => {
    void refresh();
  }, [savia]);
  const patch = (key: keyof CalendarEvent, value: string) =>
    setEvent({ ...event, [key]: value });
  function changeLocal(key: "start" | "end", value: string) {
    if (key === "start") setStartLocal(value);
    else setEndLocal(value);
    try {
      const instant = localToInstant(value, event.timeZone);
      setEvent({ ...event, [key]: instant });
      setTimeError("");
    } catch (error) {
      setEvent({ ...event, [key]: "" });
      setTimeError((error as Error).message);
    }
  }
  function changeZone(zone: string) {
    try {
      setStartLocal(instantToLocal(event.start, zone));
      setEndLocal(instantToLocal(event.end, zone));
      setEvent({ ...event, timeZone: zone });
      setTimeError("");
    } catch {
      setTimeError("Selecciona una zona horaria válida.");
    }
  }
  const zones = [
    ...new Set([
      "America/Bogota",
      event.timeZone,
      ...Intl.supportedValuesOf("timeZone"),
    ]),
  ];
  function exportEvent() {
    try {
      const url = URL.createObjectURL(
        new Blob([toICS(event)], { type: "text/calendar;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "evento.ics";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      state.setError((error as Error).message);
    }
  }
  return (
    <Shell
      title="Calendario"
      description="Organiza tus citas en su zona horaria, descárgalas o sincronízalas con tu calendario."
    >
      <IntegrationStatus state={state} connectorId={`${manifest.id}.gateway`} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            validateEvent(event);
            const input = {
              title: event.title,
              payload: JSON.stringify(event),
              stage: "scheduled",
            };
            const saved = await saveIntegrationRecord(
              savia,
              requirement.object.name,
              input,
              recordId ? { id: recordId, _version: recordVersion } : undefined,
            );
            setRecordId(saved.id);
            setRecordVersion(saved._version);
            setSavedPayload(JSON.stringify(event));
            setNotice("Evento guardado en la agenda.");
            await refresh();
          } catch (error) {
            state.setError((error as Error).message);
          }
        }}
      >
        <label>
          Título
          <input
            required
            value={event.title}
            onChange={(e) => patch("title", e.target.value)}
          />
        </label>
        <label>
          Zona horaria
          <select
            value={event.timeZone}
            onChange={(e) => changeZone(e.target.value)}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Inicio
          <input
            type="datetime-local"
            required
            value={startLocal}
            onChange={(e) => changeLocal("start", e.target.value)}
          />
        </label>
        <label>
          Fin
          <input
            type="datetime-local"
            required
            value={endLocal}
            onChange={(e) => changeLocal("end", e.target.value)}
          />
        </label>
        {timeError ? (
          <p role="alert" className="integration-wide">
            {timeError}
          </p>
        ) : null}
        <p className="integration-wide">
          Las horas corresponden a la zona seleccionada. Cambiar de zona muestra
          la misma cita en la hora local de ese lugar.
        </p>
        <label className="integration-wide">
          Descripción
          <textarea
            value={event.description}
            onChange={(e) => patch("description", e.target.value)}
          />
        </label>
        <div className="integration-actions integration-wide">
          <button type="submit" disabled={!event.start || !event.end}>
            Guardar evento
          </button>
          <button type="button" onClick={exportEvent}>
            Descargar ICS
          </button>
          <button
            type="button"
            disabled={
              state.busy ||
              !state.connections.length ||
              !recordId ||
              savedPayload !== JSON.stringify(event)
            }
            onClick={async () => {
              try {
                validateEvent(event);
                const receipt = await state.execute(
                  "sync",
                  { ...event },
                  syncOperationKey(event.id, recordVersion),
                );
                if (receipt)
                  setNotice(
                    `Sincronización: ${receipt.state} · ${receipt.reference}`,
                  );
              } catch (error) {
                state.setError((error as Error).message);
              }
            }}
          >
            Sincronizar evento guardado
          </button>
          <button
            type="button"
            onClick={() => {
              setRecordId("");
              setRecordVersion(undefined);
              setSavedPayload("");
              setEvent({
                ...event,
                id: crypto.randomUUID(),
                title: "",
                start: "",
                end: "",
              });
              setStartLocal("");
              setEndLocal("");
              setTimeError("");
            }}
          >
            Nuevo evento
          </button>
        </div>
      </form>
      <p role="status">{notice}</p>
      <section>
        <h2>Agenda guardada</h2>
        {!events.length ? (
          <p>No hay eventos guardados.</p>
        ) : (
          events.map((row) => (
            <p key={String(row.id)}>
              <button
                onClick={() => {
                  try {
                    const saved = JSON.parse(
                      String(row.payload),
                    ) as CalendarEvent;
                    validateEvent(saved);
                    setEvent(saved);
                    setStartLocal(instantToLocal(saved.start, saved.timeZone));
                    setEndLocal(instantToLocal(saved.end, saved.timeZone));
                    setTimeError("");
                    setRecordId(String(row.id));
                    setRecordVersion(
                      typeof row._version === "number"
                        ? row._version
                        : undefined,
                    );
                    setSavedPayload(
                      JSON.stringify(JSON.parse(String(row.payload))),
                    );
                  } catch {
                    state.setError("Evento no válido.");
                  }
                }}
              >
                {String(row.title)}
              </button>
            </p>
          ))
        )}
      </section>
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
    Screen: CalendarScreen,
  },
] as const;
