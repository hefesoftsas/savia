import {
  intlLocale,
  useAppLocale,
  useMessages,
  translateMessage,
} from "@/i18n/core";
import type { AppLocale } from "@/i18n/app-locale";
import { agendaMessages } from "./agenda-messages";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import GoogleCalendar from "@thesvg/react/google-calendar";
import MicrosoftOutlook from "@thesvg/react/microsoft-outlook";
import {
  CalendarDays,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { PersonalCalendarEvent } from "@/api/personal-integrations-client";
import type { CalendarSourcesClient } from "@/api/personal-integrations-client";
import {
  calendarRange,
  dateKey,
  type CalendarViewMode,
} from "./calendar-dates";
import {
  isCalendarSourcesClient,
  useCalendarSources,
} from "./use-calendar-sources";
import { CalendarView } from "./calendar-view";
import {
  useMyDayBookings,
  type BookingAgendaClient,
} from "./use-my-day-bookings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type CalendarProvider = "google_calendar" | "outlook";
export type CalendarEvent = PersonalCalendarEvent & {
  provider: CalendarProvider;
  connectionId?: string;
};
export type CalendarEventGroup = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  events: CalendarEvent[];
};
type CalendarEventLink = { provider: CalendarProvider; webLink: string };
type PendingCalendarTask = {
  title: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  videoCall: boolean;
  destination?: CalendarProvider;
};

export type PersonalIntegrationsLike = {
  listConnections: (
    refresh?: boolean,
  ) => Promise<Array<{ id?: string; status: string; provider: string }>>;
  listEvents: (args: {
    provider: CalendarProvider;
    from: string;
    to: string;
  }) => Promise<PersonalCalendarEvent[]>;
  createCalendarEvent: (args: {
    provider: CalendarProvider;
    title: string;
    startsAt: string;
    endsAt: string;
    videoCall?: boolean;
  }) => Promise<PersonalCalendarEvent>;
  deleteCalendarEvent?: (args: {
    provider: CalendarProvider;
    eventId: string;
    connectionId: string;
  }) => Promise<void>;
} & BookingAgendaClient;

const calendarProviderOrder: CalendarProvider[] = [
  "google_calendar",
  "outlook",
];

export function isCalendarProvider(value: string): value is CalendarProvider {
  return value === "google_calendar" || value === "outlook";
}

export function calendarProviderLabel(provider: CalendarProvider): string {
  return provider === "google_calendar" ? "Google Calendar" : "Outlook";
}

function conferenceProviderLabel(provider: "google_meet" | "teams"): string {
  return provider === "google_meet" ? "Google Meet" : "Microsoft Teams";
}

export function safeConferenceLink(
  provider: "google_meet" | "teams" | null,
  value: string | null,
): string | undefined {
  if (!provider) return undefined;
  const safe = secureCalendarLink(value);
  if (!safe) return undefined;
  const hostname = new URL(safe).hostname.toLowerCase();
  const allowed =
    provider === "google_meet"
      ? hostname === "meet.google.com"
      : [
          "teams.microsoft.com",
          "teams.live.com",
          "teams.cloud.microsoft",
          "gov.teams.microsoft.us",
          "dod.teams.microsoft.us",
          "teams.microsoftonline.cn",
        ].includes(hostname);
  return allowed ? safe : undefined;
}

type AgendaParams = Readonly<
  Record<string, string | number | readonly string[]>
>;
type AgendaMessage = {
  key: keyof typeof agendaMessages;
  params?: AgendaParams;
};
type AgendaFeedback = string | AgendaMessage | null;
const message = (
  key: keyof typeof agendaMessages,
  params?: AgendaParams,
): AgendaMessage => ({ key, params });

type AgendaSnapshot = {
  events: CalendarEvent[];
  calendarProviders: CalendarProvider[];
  loading: boolean;
  feedback: AgendaFeedback;
  syncError: AgendaFeedback;
};
type AgendaCacheRecord = {
  snapshot: AgendaSnapshot;
  revision: number;
  inFlight: boolean;
  listeners: Set<(snapshot: AgendaSnapshot) => void>;
};
const agendaCache = new Map<
  PersonalIntegrationsLike,
  Map<string, AgendaCacheRecord>
>();
let agendaSessionGeneration = 0;

function emptyAgendaSnapshot(): AgendaSnapshot {
  return {
    events: [],
    calendarProviders: [],
    loading: true,
    feedback: null,
    syncError: null,
  };
}

function agendaRecord(
  client: PersonalIntegrationsLike,
  dayKey: string,
): AgendaCacheRecord {
  let byDay = agendaCache.get(client);
  if (!byDay) {
    byDay = new Map();
    agendaCache.set(client, byDay);
  }
  let record = byDay.get(dayKey);
  if (!record) {
    record = {
      snapshot: emptyAgendaSnapshot(),
      revision: 0,
      inFlight: false,
      listeners: new Set(),
    };
    byDay.set(dayKey, record);
  }
  return record;
}

function publishAgenda(record: AgendaCacheRecord, snapshot: AgendaSnapshot) {
  record.snapshot = snapshot;
  for (const listener of record.listeners) listener(snapshot);
}

function clearAgendaCache() {
  agendaSessionGeneration += 1;
  for (const byDay of agendaCache.values()) {
    for (const record of byDay.values()) {
      record.revision += 1;
      record.inFlight = false;
      publishAgenda(record, emptyAgendaSnapshot());
    }
  }
  agendaCache.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("savia:session-cleared", clearAgendaCache);
  window.addEventListener("savia:identity-changed", clearAgendaCache);
}

export const CALENDAR_CONNECT_MESSAGE =
  "Conecta Google Calendar u Outlook desde Mi cuenta → Mis conexiones.";
export const CALENDAR_CONNECT_NOTICE_KEY =
  "savia.my-day.calendar-connect-dismissed";

export function isCalendarConnectNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(CALENDAR_CONNECT_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function endOfLocalDay(value: Date): Date {
  const end = startOfLocalDay(value);
  end.setDate(end.getDate() + 1);
  return end;
}

export function nextHalfHour(value = new Date()): string {
  const next = new Date(value);
  next.setMinutes(Math.ceil(next.getMinutes() / 30) * 30, 0, 0);
  return `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`;
}

function eventStart(day: Date, time: string): Date | undefined {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return undefined;
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
  );
}

function localDateFromInput(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
    ? parsed
    : undefined;
}

export function formatDay(value: Date, locale: AppLocale = "es"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(value);
}

function formatTime(value: string | null, locale: AppLocale): string {
  if (!value) return translateMessage(agendaMessages, "Sin hora", locale);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function secureCalendarLink(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function sorted(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((left, right) =>
    (left.startsAt ?? "").localeCompare(right.startsAt ?? ""),
  );
}

function eventTitle(event: CalendarEvent): string {
  return event.title?.trim() || "Evento sin título";
}

function normalizedEventTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function eventGroupId(event: CalendarEvent): string {
  return [
    eventTitle(event).replaceAll(/\s+/g, " ").toLocaleLowerCase("es-CO"),
    normalizedEventTime(event.startsAt),
    normalizedEventTime(event.endsAt),
  ].join("\u0000");
}

export function groupCalendarEvents(
  events: CalendarEvent[],
): CalendarEventGroup[] {
  const groups = new Map<string, CalendarEventGroup>();
  for (const event of sorted(events)) {
    const id = eventGroupId(event);
    const group = groups.get(id);
    if (group) {
      group.events.push(event);
      continue;
    }
    groups.set(id, {
      id,
      title: eventTitle(event),
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      events: [event],
    });
  }
  return [...groups.values()];
}

function groupProviders(group: CalendarEventGroup): CalendarProvider[] {
  return calendarProviderOrder.filter((provider) =>
    group.events.some((event) => event.provider === provider),
  );
}

function groupCalendarLinks(group: CalendarEventGroup): CalendarEventLink[] {
  return calendarProviderOrder.flatMap((provider) => {
    const event = group.events.find(
      (candidate) =>
        candidate.provider === provider &&
        secureCalendarLink(candidate.webLink),
    );
    const webLink = event && secureCalendarLink(event.webLink);
    return webLink ? [{ provider, webLink }] : [];
  });
}

function calendarProviderIcon(provider: CalendarProvider) {
  return provider === "google_calendar" ? GoogleCalendar : MicrosoftOutlook;
}

function CalendarProviderIcon({ provider }: { provider: CalendarProvider }) {
  const t = useMessages(agendaMessages);
  const Icon = calendarProviderIcon(provider);
  const displayName = calendarProviderLabel(provider);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={t("Logo de %{name}", { name: displayName })}
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
          role="img"
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {displayName}
      </TooltipContent>
    </Tooltip>
  );
}

function feedbackFrom(_error: unknown): AgendaMessage {
  return message("No pudimos sincronizar tus agendas.");
}

function calendarSyncFeedback(providers: CalendarProvider[]): AgendaMessage {
  return message("No se pudo sincronizar %{providers}.", {
    providers: providers.map(calendarProviderLabel),
  });
}

export function useMyDayAgenda(
  personalIntegrations?: PersonalIntegrationsLike &
    Partial<CalendarSourcesClient>,
  options?: { from: string; to: string },
) {
  const locale = useAppLocale();
  const localizeFeedback = (value: AgendaFeedback) =>
    typeof value === "object" && value
      ? translateMessage(
          agendaMessages,
          value.key,
          locale,
          Object.fromEntries(
            Object.entries(value.params ?? {}).map(([key, param]) => [
              key,
              Array.isArray(param)
                ? new Intl.ListFormat(intlLocale(locale)).format(param)
                : param,
            ]),
          ) as Record<string, string | number>,
        )
      : value;
  const [day] = useState(() => startOfLocalDay(new Date()));
  const [selectedDay, setSelectedDay] = useState(day);
  const [view, setView] = useState<CalendarViewMode>("day");
  const bounds = useMemo(
    () => calendarRange(selectedDay, view),
    [selectedDay, view],
  );
  const from = options?.from ?? bounds.from;
  const to = options?.to ?? bounds.to;
  const dayKey = `${from}/${to}`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const bookings = useMyDayBookings(personalIntegrations, {
    from,
    to,
    timeZone,
  });
  const sources = useCalendarSources(
    isCalendarSourcesClient(personalIntegrations)
      ? personalIntegrations
      : undefined,
    { from, to, timeZone },
  );
  const record = personalIntegrations
    ? agendaRecord(personalIntegrations, dayKey)
    : undefined;
  const [snapshotState, setSnapshot] = useState<AgendaSnapshot>(
    () => record?.snapshot ?? emptyAgendaSnapshot(),
  );
  const [snapshotOwner, setSnapshotOwner] = useState(personalIntegrations);
  const [snapshotKey, setSnapshotKey] = useState(dayKey);
  const [localEvents, setLocalEvents] = useState<CalendarEvent[]>([]);
  const localEventsRef = useRef(localEvents);
  localEventsRef.current = localEvents;
  const generationRef = useRef(agendaSessionGeneration);
  const snapshotSession = agendaSessionGeneration;

  const dismissConnectNotice = useCallback(() => {
    try {
      localStorage.setItem(CALENDAR_CONNECT_NOTICE_KEY, "1");
    } catch {
      // storage unavailable: dismiss for this session only
    }
    setFeedback((current) =>
      typeof current === "object" && current?.key === CALENDAR_CONNECT_MESSAGE
        ? null
        : current,
    );
  }, []);

  const range = useMemo(() => ({ from, to }), [from, to]);
  const snapshot =
    snapshotOwner === personalIntegrations && snapshotKey === dayKey
      ? snapshotState
      : (record?.snapshot ?? emptyAgendaSnapshot());
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const events = record ? snapshot.events : localEvents;
  const calendarProviders = record ? snapshot.calendarProviders : [];
  const loading = record ? snapshot.loading : false;
  const feedback = localizeFeedback(snapshot.feedback);
  const eventGroups = useMemo(() => groupCalendarEvents(events), [events]);

  const refresh = useCallback(
    async (background = false) => {
      if (!personalIntegrations) {
        return;
      }
      const target = agendaRecord(personalIntegrations, dayKey);
      if (background && target.inFlight) return;
      const generation = agendaSessionGeneration;
      generationRef.current = generation;
      const requestRevision = ++target.revision;
      const startedWithEventIds = new Set(
        target.snapshot.events.map((event) => `${event.provider}:${event.id}`),
      );
      const isCurrent = () =>
        generation === agendaSessionGeneration &&
        generationRef.current === generation &&
        target.revision === requestRevision;
      target.inFlight = true;
      if (!target.snapshot.events.length && target.snapshot.loading) {
        publishAgenda(target, {
          ...target.snapshot,
          loading: true,
          feedback: null,
          syncError: null,
        });
      }
      try {
        const connections = await personalIntegrations.listConnections(true);
        if (!isCurrent()) return;
        const connectedCalendars = connections.flatMap((connection) =>
          connection.status === "connected" &&
          isCalendarProvider(connection.provider)
            ? [connection.provider]
            : [],
        );
        const connectedSet = new Set(connectedCalendars);
        publishAgenda(target, {
          ...target.snapshot,
          calendarProviders: connectedCalendars,
          events: target.snapshot.events.filter((event) =>
            connectedSet.has(event.provider),
          ),
          feedback: null,
          syncError: null,
        });
        if (connectedCalendars.length === 0) {
          publishAgenda(target, {
            events: [],
            calendarProviders: [],
            loading: false,
            syncError: null,
            feedback: isCalendarConnectNoticeDismissed()
              ? null
              : message(CALENDAR_CONNECT_MESSAGE),
          });
          return;
        }
        const settled = new Set<CalendarProvider>();
        const failedProviders: CalendarProvider[] = [];
        await Promise.all(
          connectedCalendars.map(async (provider) => {
            try {
              const providerEvents = await personalIntegrations.listEvents({
                provider,
                ...range,
              });
              if (!isCurrent()) return;
              settled.add(provider);
              const withoutProvider = target.snapshot.events.filter(
                (event) => event.provider !== provider,
              );
              const addedWhilePending = target.snapshot.events.filter(
                (event) =>
                  event.provider === provider &&
                  !startedWithEventIds.has(`${event.provider}:${event.id}`),
              );
              const refreshedEvents = [
                ...providerEvents.map((event) => ({
                  ...event,
                  provider,
                  connectionId: connections.find(
                    (connection) => connection.provider === provider,
                  )?.id,
                })),
                ...addedWhilePending,
              ];
              const uniqueRefreshedEvents = refreshedEvents.filter(
                (event, index, values) =>
                  values.findIndex(
                    (candidate) =>
                      candidate.provider === event.provider &&
                      candidate.id === event.id,
                  ) === index,
              );
              const nextEvents = [...withoutProvider, ...uniqueRefreshedEvents];
              publishAgenda(target, {
                ...target.snapshot,
                events: sorted(nextEvents),
                loading: false,
                feedback:
                  failedProviders.length > 0
                    ? calendarSyncFeedback(failedProviders)
                    : null,
                syncError:
                  failedProviders.length > 0
                    ? calendarSyncFeedback(failedProviders)
                    : null,
              });
            } catch {
              if (!isCurrent()) return;
              settled.add(provider);
              failedProviders.push(provider);
              publishAgenda(target, {
                ...target.snapshot,
                loading: false,
                feedback: calendarSyncFeedback(failedProviders),
                syncError: calendarSyncFeedback(failedProviders),
              });
            }
          }),
        );
        if (!isCurrent()) return;
        // A provider that rejected keeps its previous cached events for stale-while-refresh.
        if (settled.size === connectedCalendars.length) {
          publishAgenda(target, {
            ...target.snapshot,
            loading: false,
            feedback:
              failedProviders.length > 0
                ? calendarSyncFeedback(failedProviders)
                : null,
            syncError:
              failedProviders.length > 0
                ? calendarSyncFeedback(failedProviders)
                : null,
          });
        }
      } catch (error) {
        if (isCurrent()) {
          publishAgenda(target, {
            ...target.snapshot,
            loading: false,
            feedback: feedbackFrom(error),
            syncError: feedbackFrom(error),
          });
        }
      } finally {
        if (isCurrent()) target.inFlight = false;
      }
    },
    [dayKey, range, personalIntegrations],
  );

  useEffect(() => {
    if (!record) return;
    const listener = (next: AgendaSnapshot) => {
      setSnapshot(next);
      setSnapshotKey(dayKey);
    };
    record.listeners.add(listener);
    setSnapshot(record.snapshot);
    setSnapshotOwner(personalIntegrations);
    setSnapshotKey(dayKey);
    void refresh(true);
    return () => {
      record.listeners.delete(listener);
    };
  }, [record, refresh, personalIntegrations, dayKey]);

  useEffect(() => {
    const reset = () => {
      generationRef.current = agendaSessionGeneration;
      setSnapshot(emptyAgendaSnapshot());
      setSnapshotOwner(personalIntegrations);
      setLocalEvents([]);
      localEventsRef.current = [];
      void refresh(true);
    };
    window.addEventListener("savia:session-cleared", reset);
    window.addEventListener("savia:identity-changed", reset);
    return () => {
      window.removeEventListener("savia:session-cleared", reset);
      window.removeEventListener("savia:identity-changed", reset);
    };
  }, [personalIntegrations, refresh]);

  useEffect(() => {
    if (!personalIntegrations) return;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const visible = () =>
      document.visibilityState !== "hidden" && navigator.onLine;
    const schedule = () => {
      if (!disposed) timer = setTimeout(tick, 300000);
    };
    const tick = async () => {
      clearTimeout(timer);
      if (visible()) await refresh(true);
      schedule();
    };
    const resume = () => {
      clearTimeout(timer);
      if (visible()) void tick();
    };
    schedule();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [personalIntegrations, refresh]);

  const setEvents = useCallback<
    React.Dispatch<React.SetStateAction<CalendarEvent[]>>
  >(
    (update) => {
      if (snapshotSession !== agendaSessionGeneration) return;
      if (record) {
        const events =
          typeof update === "function"
            ? update(record.snapshot.events)
            : update;
        const visibleEvents = events.filter((event) => {
          if (!event.startsAt) return false;
          const end = event.endsAt ?? event.startsAt;
          if (event.allDay || /^\d{4}-\d{2}-\d{2}$/.test(event.startsAt))
            return (
              event.startsAt < dateKey(new Date(to)) &&
              end > dateKey(new Date(from))
            );
          const startsAt = Date.parse(event.startsAt),
            endsAt = Date.parse(end);
          return (
            startsAt < Date.parse(to) &&
            (endsAt > Date.parse(from) ||
              (endsAt === startsAt && startsAt >= Date.parse(from)))
          );
        });
        publishAgenda(record, {
          ...record.snapshot,
          events: sorted(visibleEvents),
        });
      } else {
        const events =
          typeof update === "function"
            ? update(localEventsRef.current)
            : update;
        localEventsRef.current = events;
        setLocalEvents(events);
      }
    },
    [record, from, to, snapshotSession],
  );

  const setFeedback = useCallback<
    React.Dispatch<React.SetStateAction<AgendaFeedback>>
  >(
    (update) => {
      if (snapshotSession !== agendaSessionGeneration) return;
      const next =
        typeof update === "function"
          ? update(snapshotRef.current.feedback)
          : update;
      if (record) publishAgenda(record, { ...record.snapshot, feedback: next });
      else setSnapshot((current) => ({ ...current, feedback: next }));
    },
    [record, snapshotSession],
  );

  return {
    day,
    selectedDay,
    setSelectedDay,
    view,
    setView,
    bounds,
    timeZone,
    sources,
    personalIntegrations,
    events,
    setEvents,
    eventGroups,
    calendarProviders,
    loading: loading || bookings.loading,
    bookings,
    feedback,
    syncError: localizeFeedback(snapshot.syncError),
    isCalendarConnectNotice:
      typeof snapshot.feedback === "object" &&
      snapshot.feedback?.key === CALENDAR_CONNECT_MESSAGE,
    setFeedback,
    dismissConnectNotice,
    refresh: async () => {
      await Promise.all([refresh(), sources.refresh(), bookings.refresh()]);
    },
  };
}

export type AgendaState = ReturnType<typeof useMyDayAgenda>;

export function AgendaWidgetBody({ agenda }: { agenda: AgendaState }) {
  const visibleEvents = agenda.events.filter(
    (event) => agenda.sources.preferences[event.provider],
  );
  return (
    <CalendarView
      agenda={agenda}
      legacyDay={
        <ProviderAgendaBody
          agenda={{
            ...agenda,
            events: visibleEvents,
            eventGroups: groupCalendarEvents(visibleEvents),
          }}
        />
      }
    />
  );
}

function ProviderAgendaBody({ agenda }: { agenda: AgendaState }) {
  const t = useMessages(agendaMessages);
  const locale = useAppLocale();
  const { eventGroups, loading, refresh } = agenda;

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={t("Cargando agenda…")}
        className="space-y-3"
      >
        <span className="sr-only">{t("Cargando agenda…")}</span>
        <div className="divide-y rounded-xl border border-border/60 bg-card">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-3 px-4 py-3.5"
            >
              <Skeleton className="h-4 w-20" />
              <div className="min-w-44 flex-1 space-y-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="size-6 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (eventGroups.length === 0) {
    return (
      <div
        className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center"
        data-testid="my-day-agenda-empty"
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
          <CalendarDays aria-hidden="true" className="size-6 text-primary" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-foreground">
          {agenda.selectedDay.toDateString() === agenda.day.toDateString()
            ? t("Sin eventos para hoy")
            : t("Sin eventos para este día")}
        </h3>
        <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">
          {t(
            "Tu agenda está libre. Crea una tarea para bloquear tiempo en tu calendario.",
          )}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
            title={t("Agregar tarea")}
            onClick={() =>
              document.getElementById("my-day-task")?.focus({
                preventScroll: false,
              })
            }
          >
            <Plus aria-hidden="true" className="size-4 sm:hidden" />
            <span className="sr-only sm:not-sr-only">{t("Agregar tarea")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
            title={t("Sincronizar")}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            <span className="sr-only sm:not-sr-only">{t("Sincronizar")}</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-xl border border-border/60 bg-card">
      {eventGroups.map((group) => {
        const linkedCalendars = groupCalendarLinks(group);
        const linkedCalendar = linkedCalendars[0];
        const providers = groupProviders(group);
        const conference = group.events.find(
          (event) => event.conference,
        )?.conference;
        const joinUrl =
          conference?.status === "ready"
            ? safeConferenceLink(conference.provider, conference.joinUrl)
            : undefined;
        return (
          <li
            key={group.id}
            className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <span className="min-w-20 text-sm font-semibold tabular-nums text-muted-foreground">
              {group.events[0]?.allDay
                ? t("Todo el día")
                : formatTime(group.startsAt, locale)}
            </span>
            <div className="min-w-44 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium leading-5">
                  {group.events[0]?.title?.trim() || t("Evento sin título")}
                </p>
                <div
                  aria-label={t("Agendada en %{providers}", {
                    providers: new Intl.ListFormat(intlLocale(locale)).format(
                      providers.map(calendarProviderLabel),
                    ),
                  })}
                  className="flex items-center gap-1"
                >
                  {providers.map((provider) => (
                    <CalendarProviderIcon key={provider} provider={provider} />
                  ))}
                </div>
              </div>
              <p className="text-sm tabular-nums text-muted-foreground">
                {group.events[0]?.allDay
                  ? t("Todo el día")
                  : t("Hasta %{time}", {
                      time: formatTime(group.endsAt, locale),
                    })}
              </p>
              {conference ? (
                conference.status === "ready" && joinUrl ? (
                  <a
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    href={joinUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("Unirse a %{provider}", {
                      provider: conferenceProviderLabel(conference.provider!),
                    })}
                  >
                    {t("Unirse a %{provider}", {
                      provider: conferenceProviderLabel(conference.provider!),
                    })}
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {conference.status === "pending"
                      ? t("El enlace de la reunión se está preparando.")
                      : conference.status === "unsupported"
                        ? t(
                            "Las videollamadas no son compatibles con esta cuenta de calendario.",
                          )
                        : conference.status === "failed"
                          ? t("No se pudo crear el enlace de la reunión.")
                          : t("El enlace de la reunión no está disponible.")}
                  </p>
                )
              ) : null}
            </div>
            {linkedCalendars.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto gap-1 px-0 py-0"
                    aria-label={t("Ver en calendario")}
                  >
                    {t("Ver")}
                    <ExternalLink className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {linkedCalendars.map(({ provider, webLink }) => {
                    const Icon = calendarProviderIcon(provider);
                    return (
                      <DropdownMenuItem asChild key={provider}>
                        <a
                          aria-label={t("Abrir en %{provider}", {
                            provider: calendarProviderLabel(provider),
                          })}
                          href={webLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Icon aria-hidden="true" className="size-4" />
                          {calendarProviderLabel(provider)}
                          <ExternalLink className="ml-auto size-3.5" />
                        </a>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : linkedCalendar ? (
              <a
                aria-label={t("Ver en %{provider}", {
                  provider: calendarProviderLabel(linkedCalendar.provider),
                })}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                href={linkedCalendar.webLink}
                target="_blank"
                rel="noreferrer"
              >
                {t("Ver")}
                <ExternalLink className="size-3.5" />
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">
                {t("Enlace no disponible")}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function QuickTaskWidgetBody({
  agenda,
  personalIntegrations,
}: {
  agenda: AgendaState;
  personalIntegrations?: PersonalIntegrationsLike;
}) {
  const t = useMessages(agendaMessages);
  const locale = useAppLocale();
  const list = (providers: CalendarProvider[]) =>
    new Intl.ListFormat(intlLocale(locale), { type: "conjunction" }).format(
      providers.map(calendarProviderLabel),
    );
  const [title, setTitle] = useState("");
  const [time, setTime] = useState(nextHalfHour);
  const [duration, setDuration] = useState("30");
  const [videoCall, setVideoCall] = useState(false);
  const [callDate, setCallDate] = useState(() => dateKey(new Date()));
  const [selectedDestination, setSelectedDestination] = useState<
    CalendarProvider | ""
  >("");
  const [pendingTask, setPendingTask] = useState<PendingCalendarTask | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const { day, calendarProviders, setEvents, setFeedback } = agenda;

  useEffect(() => {
    const reset = () => {
      setPendingTask(null);
      setTitle("");
      setCreating(false);
      setVideoCall(false);
      setCallDate(dateKey(new Date()));
      setSelectedDestination("");
    };
    reset();
    window.addEventListener("savia:identity-changed", reset);
    window.addEventListener("savia:session-cleared", reset);
    return () => {
      window.removeEventListener("savia:identity-changed", reset);
      window.removeEventListener("savia:session-cleared", reset);
    };
  }, [personalIntegrations]);

  function prepareEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startsAt = eventStart(
      videoCall ? (localDateFromInput(callDate) ?? new Date(Number.NaN)) : day,
      time,
    );
    const minutes = Number(duration);
    if (
      !title.trim() ||
      !startsAt ||
      Number.isNaN(startsAt.getTime()) ||
      !Number.isInteger(minutes) ||
      minutes < 5
    ) {
      setFeedback(
        message(
          "Indica una tarea, una hora válida y una duración de al menos 5 minutos.",
        ),
      );
      return;
    }
    if (calendarProviders.length === 0) {
      setFeedback(message(CALENDAR_CONNECT_MESSAGE));
      return;
    }
    const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
    setPendingTask({
      title: title.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      minutes,
      videoCall,
      ...(videoCall
        ? {
            destination:
              selectedDestination &&
              calendarProviders.includes(selectedDestination)
                ? selectedDestination
                : calendarProviders[0],
          }
        : {}),
    });
  }

  async function createEvent() {
    if (!pendingTask || !personalIntegrations) return;
    if (
      pendingTask.videoCall &&
      (!pendingTask.destination ||
        !calendarProviders.includes(pendingTask.destination))
    ) {
      setFeedback(message("El calendario seleccionado ya no está conectado."));
      setPendingTask(null);
      return;
    }
    setCreating(true);
    setFeedback(null);
    try {
      const targetProviders = pendingTask.videoCall
        ? pendingTask.destination
          ? [pendingTask.destination]
          : []
        : calendarProviders;
      const results = await Promise.all(
        targetProviders.map(async (provider) => {
          try {
            return {
              provider,
              event: await personalIntegrations.createCalendarEvent({
                provider,
                title: pendingTask.title,
                startsAt: pendingTask.startsAt,
                endsAt: pendingTask.endsAt,
                ...(pendingTask.videoCall ? { videoCall: true } : {}),
              }),
            };
          } catch {
            return { provider };
          }
        }),
      );
      const created = results.flatMap((result) =>
        result.event ? [{ ...result.event, provider: result.provider }] : [],
      );
      const failedProviders = results.flatMap((result) =>
        result.event ? [] : [result.provider],
      );
      if (created.length === 0) {
        setFeedback(
          message("No pudimos crear la tarea en tus calendarios conectados."),
        );
        return;
      }
      setEvents((current) =>
        [...current, ...created].sort((left, right) =>
          (left.startsAt ?? "").localeCompare(right.startsAt ?? ""),
        ),
      );
      setTitle("");
      const successfulNames = created.map(({ provider }) =>
        calendarProviderLabel(provider),
      );
      setFeedback(
        failedProviders.length > 0
          ? message(
              "La tarea quedó creada en %{providers}. No se pudo crear en %{failed}.",
              {
                providers: successfulNames,
                failed: failedProviders.map(calendarProviderLabel),
              },
            )
          : message("La tarea quedó creada en %{providers}.", {
              providers: successfulNames,
            }),
      );
    } finally {
      setCreating(false);
      setPendingTask(null);
    }
  }

  return (
    <>
      <form className="space-y-4" onSubmit={prepareEvent}>
        <p className="text-xs text-muted-foreground">
          {videoCall
            ? t("Fecha: %{date}", {
                date: formatDay(localDateFromInput(callDate) ?? day, locale),
              })
            : `${t("Crear para hoy:")} ${formatDay(day, locale)}`}
        </p>
        <div className="space-y-2">
          <Label htmlFor="my-day-task">{t("Tarea")}</Label>
          <Input
            id="my-day-task"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("Ej. Preparar propuesta")}
            maxLength={2000}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="my-day-time">{t("Hora")}</Label>
            <Input
              id="my-day-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="my-day-duration">{t("Duración (min)")}</Label>
            <Input
              id="my-day-duration"
              type="number"
              min="5"
              step="5"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              required
            />
          </div>
        </div>
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={videoCall}
              onChange={(event) => setVideoCall(event.target.checked)}
              aria-label={t("Crear una videollamada")}
              className="size-4 accent-primary"
            />
            {t("Crear una videollamada")}
          </label>
          {videoCall ? (
            <div className="space-y-2">
              <Label htmlFor="my-day-call-date">
                {t("Fecha de la videollamada")}
              </Label>
              <Input
                id="my-day-call-date"
                type="date"
                value={callDate}
                onChange={(event) => setCallDate(event.target.value)}
                required
              />
              <Label htmlFor="my-day-video-calendar">
                {t("Calendario para la videollamada")}
              </Label>
              <select
                id="my-day-video-calendar"
                aria-label={t("Calendario para la videollamada")}
                value={
                  selectedDestination &&
                  calendarProviders.includes(selectedDestination)
                    ? selectedDestination
                    : calendarProviders[0] || ""
                }
                onChange={(event) =>
                  setSelectedDestination(event.target.value as CalendarProvider)
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {calendarProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {calendarProviderLabel(provider)} —{" "}
                    {t(
                      provider === "google_calendar"
                        ? "Google Meet"
                        : "Microsoft Teams",
                    )}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <Button
          className="w-full"
          type="submit"
          disabled={creating || calendarProviders.length === 0}
        >
          {creating ? <LoaderCircle className="animate-spin" /> : null}
          {t("Crear tarea")}
        </Button>
        {calendarProviders.length === 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {t("Conecta un calendario para habilitar la creación de tareas.")}
          </p>
        ) : null}
      </form>
      <Dialog
        open={pendingTask !== null}
        onOpenChange={(open) => {
          if (!open && !creating) setPendingTask(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Confirmar tarea")}</DialogTitle>
            <DialogDescription>
              {t(
                "Crearás “%{title}” de %{start} a %{end} durante %{minutes} minutos en %{providers}.",
                {
                  title: pendingTask?.title ?? "",
                  start: formatTime(pendingTask?.startsAt ?? null, locale),
                  end: formatTime(pendingTask?.endsAt ?? null, locale),
                  minutes: pendingTask?.minutes ?? 0,
                  providers:
                    pendingTask?.videoCall && pendingTask.destination
                      ? list([pendingTask.destination])
                      : list(calendarProviders),
                },
              )}
              {pendingTask?.videoCall && pendingTask.destination ? (
                <span className="mt-1 block">
                  {t("Fecha: %{date}", {
                    date: formatDay(new Date(pendingTask.startsAt), locale),
                  })}{" "}
                  {t(
                    "Crearás esta videollamada en %{calendar} con %{provider}.",
                    {
                      calendar: calendarProviderLabel(pendingTask.destination),
                      provider: t(
                        pendingTask.destination === "google_calendar"
                          ? "Google Meet"
                          : "Microsoft Teams",
                      ),
                    },
                  )}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingTask(null)}
              disabled={creating}
            >
              {t("Cancelar")}
            </Button>
            <Button
              type="button"
              onClick={() => void createEvent()}
              disabled={creating}
            >
              {creating ? <LoaderCircle className="animate-spin" /> : null}
              {t("Confirmar creación")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
