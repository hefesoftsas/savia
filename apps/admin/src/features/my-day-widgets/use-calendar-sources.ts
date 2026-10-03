import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarSourcesClient } from "@/api/personal-integrations-client";
import type {
  CalendarOccurrence,
  CalendarPreferences,
  CalendarRange,
  CalendarSource,
  CreateCalendarSourceInput,
  UpdateCalendarSourceInput,
} from "@savia/studio-shared/calendar-contracts";
import { calendarLimits } from "@savia/studio-shared/calendar-contracts";

type Snapshot = {
  sources: CalendarSource[];
  events: CalendarOccurrence[];
  preferences: CalendarPreferences;
  errors: Record<string, string>;
  loading: boolean;
};
const empty = (loading = false): Snapshot => ({
  sources: [],
  events: [],
  preferences: { google_calendar: true, outlook: true },
  errors: {},
  loading,
});
let generation = 0;
let cache = new WeakMap<CalendarSourcesClient, Map<string, Snapshot>>();
if (typeof window !== "undefined") {
  const reset = () => {
    generation++;
    cache = new WeakMap();
  };
  window.addEventListener("savia:session-cleared", reset);
  window.addEventListener("savia:identity-changed", reset);
}
export function isCalendarSourcesClient(
  value: unknown,
): value is CalendarSourcesClient {
  if (!value || typeof value !== "object") return false;
  return [
    "listCalendarSources",
    "listCalendarSourceEvents",
    "createCalendarSource",
    "updateCalendarSource",
    "deleteCalendarSource",
    "refreshCalendarSource",
    "getCalendarPreferences",
    "saveCalendarPreferences",
  ].every(
    (key) => typeof (value as Record<string, unknown>)[key] === "function",
  );
}
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "No pudimos leer este calendario. Vuelve a sincronizar.";
const accessDenied = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    [401, 403].includes(Number(error.status)),
  );

export function useCalendarSources(
  client: CalendarSourcesClient | undefined,
  range: CalendarRange,
) {
  const key = `${range.from}/${range.to}/${range.timeZone}`;
  const active = useRef({ client, key, generation });
  active.current = { client, key, generation };
  const revision = useRef(0);
  const pending = useRef<{
    key: string;
    force: boolean;
    promise: Promise<void>;
  } | null>(null);
  const [state, setState] = useState(() => ({
    client,
    key,
    generation,
    snapshot: (client && cache.get(client)?.get(key)) || empty(Boolean(client)),
  }));
  const snapshot =
    state.client === client &&
    state.key === key &&
    state.generation === generation
      ? state.snapshot
      : (client && cache.get(client)?.get(key)) || empty(Boolean(client));
  const current = useRef(snapshot);
  current.current = snapshot;
  const publish = useCallback(
    (next: Snapshot) => {
      current.current = next;
      if (client) {
        let records = cache.get(client);
        if (!records) {
          records = new Map();
          cache.set(client, records);
        }
        records.set(key, next);
        if (records.size > 16) records.delete(records.keys().next().value!);
      }
      setState({ client, key, generation, snapshot: next });
    },
    [client, key],
  );

  const refresh = useCallback(
    (force = true): Promise<void> => {
      if (!client) return Promise.resolve();
      if (pending.current?.key === key && (pending.current.force || !force))
        return pending.current.promise;
      const request = ++revision.current,
        session = generation;
      const isCurrent = () =>
        revision.current === request &&
        session === generation &&
        active.current.client === client &&
        active.current.key === key;
      const promise = (async () => {
        try {
          const [sourcesResult, preferencesResult] = await Promise.allSettled([
            client.listCalendarSources(),
            client.getCalendarPreferences(),
          ]);
          if (!isCurrent()) return;
          if (sourcesResult.status === "rejected") {
            if (accessDenied(sourcesResult.reason)) cache.delete(client);
            publish({
              ...(accessDenied(sourcesResult.reason)
                ? empty()
                : current.current),
              loading: false,
              errors: {
                ...current.current.errors,
                _sources: errorMessage(sourcesResult.reason),
              },
            });
            return;
          }
          const sources = sourcesResult.value;
          const ids = new Set(
            sources
              .filter((source) => source.visible)
              .map((source) => source.id),
          );
          publish({
            ...current.current,
            sources,
            preferences:
              preferencesResult.status === "fulfilled"
                ? preferencesResult.value
                : current.current.preferences,
            events: current.current.events.filter((event) =>
              ids.has(event.sourceId),
            ),
            errors:
              preferencesResult.status === "rejected"
                ? {
                    _preferences:
                      "No pudimos cargar la visibilidad de tus calendarios.",
                  }
                : {},
            loading: ids.size > 0 && current.current.events.length === 0,
          });
          await Promise.all(
            sources
              .filter((source) => source.visible)
              .map(async (source) => {
                try {
                  const page = await client.listCalendarSourceEvents(
                    source.id,
                    { ...range, refresh: force },
                  );
                  if (!isCurrent()) return;
                  const errors = { ...current.current.errors };
                  if (page.stale || page.error)
                    errors[source.id] =
                      page.error ||
                      "Mostramos la última copia disponible. Vuelve a sincronizar.";
                  else delete errors[source.id];
                  publish({
                    ...current.current,
                    events: [
                      ...current.current.events.filter(
                        (event) => event.sourceId !== source.id,
                      ),
                      ...page.data,
                    ],
                    sources: current.current.sources.map((item) =>
                      item.id === source.id
                        ? { ...item, lastSyncedAt: page.lastSyncedAt }
                        : item,
                    ),
                    errors,
                    loading: false,
                  });
                } catch (error) {
                  if (!isCurrent()) return;
                  const denied =
                    error &&
                    typeof error === "object" &&
                    "status" in error &&
                    [401, 403, 404].includes(Number(error.status));
                  publish({
                    ...current.current,
                    events: denied
                      ? current.current.events.filter(
                          (event) => event.sourceId !== source.id,
                        )
                      : current.current.events,
                    errors: {
                      ...current.current.errors,
                      [source.id]: errorMessage(error),
                    },
                    loading: false,
                  });
                }
              }),
          );
          if (isCurrent()) publish({ ...current.current, loading: false });
        } catch (error) {
          if (isCurrent())
            publish({
              ...current.current,
              loading: false,
              errors: {
                ...current.current.errors,
                _sources: errorMessage(error),
              },
            });
        } finally {
          if (revision.current === request) pending.current = null;
        }
      })();
      pending.current = { key, force, promise };
      return promise;
    },
    [client, key, range.from, range.to, range.timeZone, publish],
  );

  useEffect(() => {
    revision.current++;
    pending.current = null;
    void refresh(false);
    return () => {
      revision.current++;
      pending.current = null;
    };
  }, [refresh]);
  useEffect(() => {
    const reset = () => {
      revision.current++;
      pending.current = null;
      publish(empty(Boolean(client)));
      void refresh(false);
    };
    window.addEventListener("savia:identity-changed", reset);
    window.addEventListener("savia:session-cleared", reset);
    return () => {
      window.removeEventListener("savia:identity-changed", reset);
      window.removeEventListener("savia:session-cleared", reset);
    };
  }, [client, publish, refresh]);
  useEffect(() => {
    if (!client) return;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const visible = () =>
      document.visibilityState !== "hidden" && navigator.onLine;
    const schedule = () => {
      if (!disposed) timer = setTimeout(tick, calendarLimits.freshnessMs);
    };
    const tick = async () => {
      clearTimeout(timer);
      if (visible()) await refresh(false);
      schedule();
    };
    const resume = () => {
      clearTimeout(timer);
      if (visible()) void tick();
    };
    schedule();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
    };
  }, [client, refresh]);

  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  const latestPublish = useRef(publish);
  latestPublish.current = publish;

  const requireClient = () => {
    if (!client)
      throw new Error("Los calendarios compartidos no están disponibles.");
    return client;
  };
  const mutate = async <T>(action: () => Promise<T>): Promise<T> => {
    const session = generation;
    const result = await action();
    if (session !== generation)
      throw new Error("La sesión ha cambiado. Vuelve a abrir tus calendarios.");
    if (active.current.client !== client) return result;
    if (client) cache.delete(client);
    revision.current++;
    pending.current = null;
    await latestRefresh.current(false);
    return result;
  };
  const addSource = (input: CreateCalendarSourceInput) =>
    mutate(() => requireClient().createCalendarSource(input));
  const updateSource = (id: string, input: UpdateCalendarSourceInput) =>
    mutate(() => requireClient().updateCalendarSource(id, input));
  const removeSource = async (id: string) => {
    const session = generation;
    await requireClient().deleteCalendarSource(id);
    if (session !== generation) return;
    if (active.current.client !== client) return;
    if (client) cache.delete(client);
    revision.current++;
    pending.current = null;
    const errors = { ...current.current.errors };
    delete errors[id];
    latestPublish.current({
      ...current.current,
      sources: current.current.sources.filter((source) => source.id !== id),
      events: current.current.events.filter((event) => event.sourceId !== id),
      errors,
      loading: false,
    });
  };
  const refreshSource = (id: string) =>
    mutate(() => requireClient().refreshCalendarSource(id));
  const savePreferences = async (preferences: CalendarPreferences) => {
    const session = generation;
    const saved = await requireClient().saveCalendarPreferences(preferences);
    if (session === generation && active.current.client === client) {
      if (client) cache.delete(client);
      latestPublish.current({ ...current.current, preferences: saved });
    }
  };
  return {
    ...snapshot,
    refresh,
    addSource,
    updateSource,
    removeSource,
    refreshSource,
    savePreferences,
    available: Boolean(client),
  };
}
export type CalendarSourcesState = ReturnType<typeof useCalendarSources>;
