import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type {
  CalendarColor,
  CalendarOccurrence,
} from "@savia/studio-shared/calendar-contracts";
import type { BookingAgendaEntry } from "@savia/studio-shared/booking-agenda-contracts";
import {
  buildTenantOrigin,
  KNOWN_CANONICAL_HOSTS,
  normalizeTenantSlug,
  parseTenantSlugFromHostname,
} from "@savia/tenant-host";
import { Button } from "@/components/ui/button";
import { MeetingLinkActions } from "@/components/meeting-link-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { safeConferenceLink, type AgendaState } from "./agenda-widget";
import type { PersonalCalendarConference } from "@/api/personal-integrations-client";
import { agendaMessages } from "./agenda-messages";
import {
  calendarDays,
  addDays,
  dateKey,
  eventsForDay,
  moveCalendarDate,
} from "./calendar-dates";
import { CalendarSourceManager } from "./calendar-source-manager";
import {
  useAppLocale,
  useMessages,
  intlLocale,
  type MessageParams,
} from "@/i18n/core";
import { calendarMessages } from "./calendar-messages";

const sourceColors: Record<CalendarColor, string> = {
  blue: "bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  emerald:
    "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  violet:
    "bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
  amber: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  rose: "bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
  slate: "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
};
function safeLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function tenantBookingsLink(
  slug: string,
  startsAt: string,
  hostname: string,
): string | null {
  const normalizedSlug = normalizeTenantSlug(slug);
  if (!normalizedSlug) return null;
  const canonical = KNOWN_CANONICAL_HOSTS.find(
    (host) =>
      hostname === host ||
      (hostname.endsWith(`.${host}`) &&
        parseTenantSlugFromHostname(hostname, host) !== null),
  );
  const start = new Date(startsAt);
  const date = Number.isNaN(start.getTime()) ? "" : dateKey(start);
  return canonical && date
    ? `${buildTenantOrigin(normalizedSlug, canonical)}/#/bookings?tab=reservations&date=${encodeURIComponent(date)}`
    : null;
}
type AgendaOccurrence = CalendarOccurrence & {
  booking?: BookingAgendaEntry;
  conference?: PersonalCalendarConference;
  personalEventProvider?: "google_calendar" | "outlook";
  personalEventId?: string;
  personalConnectionId?: string;
};

function safeEventConferenceLink(
  conference: PersonalCalendarConference | undefined,
) {
  return conference?.status === "ready"
    ? safeConferenceLink(conference.provider, conference.joinUrl)
    : undefined;
}
function eventTime(
  event: CalendarOccurrence,
  locale: string,
  allDayLabel: string,
): string {
  return event.allDay
    ? allDayLabel
    : new Date(event.startsAt).toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      });
}
function allDayPeriod(event: CalendarOccurrence, locale: string): string {
  const parseDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const first = parseDate(event.startsAt),
    last = addDays(parseDate(event.endsAt), -1);
  const format = (date: Date) =>
    date.toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  return dateKey(first) === dateKey(last)
    ? format(first)
    : `${format(first)} – ${format(last)}`;
}
export function CalendarView({
  agenda,
  legacyDay,
}: {
  agenda: AgendaState;
  legacyDay: ReactNode;
}) {
  const t = useMessages(calendarMessages);
  const agendaText = useMessages(agendaMessages);
  const locale = intlLocale(useAppLocale());
  const [managerOpen, setManagerOpen] = useState(false),
    [detail, setDetail] = useState<CalendarOccurrence | null>(null),
    [deleteConfirmation, setDeleteConfirmation] = useState(false),
    [deletePending, setDeletePending] = useState(false),
    [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteGeneration = useRef(0);
  const {
    selectedDay,
    setSelectedDay,
    view,
    setView,
    bounds,
    sources,
    timeZone,
  } = agenda;
  useEffect(() => {
    const reset = () => {
      setManagerOpen(false);
      setDetail(null);
      setDeleteConfirmation(false);
      setDeletePending(false);
      setDeleteError(null);
      deleteGeneration.current += 1;
    };
    window.addEventListener("savia:identity-changed", reset);
    window.addEventListener("savia:session-cleared", reset);
    window.addEventListener("savia:personal-integrations-changed", reset);
    return () => {
      window.removeEventListener("savia:identity-changed", reset);
      window.removeEventListener("savia:session-cleared", reset);
      window.removeEventListener("savia:personal-integrations-changed", reset);
    };
  }, []);
  useEffect(() => {
    setDetail(null);
    setManagerOpen(false);
    setDeleteConfirmation(false);
    setDeletePending(false);
    setDeleteError(null);
    deleteGeneration.current += 1;
  }, [agenda.personalIntegrations]);
  useEffect(() => {
    setDeleteError(null);
  }, [detail?.id]);
  useEffect(() => {
    if (!detail?.id.startsWith("savia-booking:")) return;
    const booking = agenda.bookings.entries.find(
      (entry) => `savia-booking:${entry.id}` === detail.id,
    );
    if (!booking) {
      setDetail(null);
      return;
    }
    setDetail((current) =>
      current
        ? {
            ...current,
            title: `${booking.serviceName} · ${booking.customerName}`,
            startsAt: booking.startsAt,
            endsAt: booking.endsAt,
            timeZone: booking.timeZone,
            booking,
          }
        : current,
    );
  }, [agenda.bookings.entries, detail?.id]);
  const events = useMemo(
    () => [
      ...agenda.events
        .filter(
          (event) =>
            !agenda.bookings.entries.some(
              (booking) =>
                booking.externalEvent?.provider === event.provider &&
                booking.externalEvent.id === event.id,
            ),
        )
        .filter((event) => sources.preferences[event.provider])
        .flatMap((event) =>
          event.startsAt
            ? [
                {
                  id: `${event.provider}:${event.id}`,
                  sourceId: event.provider,
                  title: event.title,
                  startsAt: event.startsAt,
                  endsAt: event.endsAt ?? event.startsAt,
                  allDay:
                    event.allDay ?? /^\d{4}-\d{2}-\d{2}$/.test(event.startsAt),
                  timeZone: event.timeZone ?? timeZone,
                  webLink: event.webLink,
                  conference: event.conference,
                  personalEventProvider: event.provider,
                  personalEventId: event.id,
                  personalConnectionId: event.connectionId,
                },
              ]
            : [],
        ),
      ...agenda.bookings.entries.map((booking) => ({
        id: `savia-booking:${booking.id}`,
        sourceId: `savia-bookings:${booking.tenantId}`,
        title: `${booking.serviceName} · ${booking.customerName}`,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        allDay: false,
        timeZone: booking.timeZone,
        webLink: null,
        conference: booking.conference,
        booking,
      })),
      ...sources.events,
    ],
    [
      agenda.events,
      agenda.bookings.entries,
      sources.events,
      sources.preferences,
      timeZone,
    ],
  );
  const days = calendarDays(bounds.start, bounds.end);
  const today = dateKey(new Date());
  const label =
    view === "month"
      ? selectedDay.toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
        })
      : view === "week"
        ? `${bounds.start.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`
        : selectedDay.toLocaleDateString(locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          });
  const compactLabel =
    view === "day"
      ? selectedDay.toLocaleDateString(locale, {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : label;
  function sourceName(id: string) {
    if (id.startsWith("savia-bookings:")) {
      const tenantId = Number(id.slice("savia-bookings:".length));
      return (
        agenda.bookings.entries.find((entry) => entry.tenantId === tenantId)
          ?.tenantName ?? t("Savia bookings")
      );
    }
    return id === "google_calendar"
      ? t("Google Calendar")
      : id === "outlook"
        ? t("Outlook")
        : (sources.sources.find((source) => source.id === id)?.name ??
          t("Calendars"));
  }
  function sourceColor(id: string): CalendarColor {
    return id === "google_calendar"
      ? "blue"
      : id === "outlook"
        ? "emerald"
        : (sources.sources.find((source) => source.id === id)?.color ??
          "slate");
  }
  function eventRow(event: AgendaOccurrence, compact = false) {
    const conference = event.conference;
    const joinUrl = safeEventConferenceLink(conference);
    const meetingProvider =
      conference?.provider === "jitsi"
        ? "Jitsi"
        : conference?.provider === "zoom"
          ? agendaText("Zoom")
          : conference?.provider === "google_meet"
            ? agendaText("Google Meet")
            : agendaText("Microsoft Teams");
    const personalCalendarStatus = event.personalEventProvider
      ? agendaText("Agendada en %{providers}", {
          providers: sourceName(event.personalEventProvider),
        })
      : event.booking?.externalEvent
        ? agendaText("Vinculado a %{provider}", {
            provider: sourceName(event.booking.externalEvent.provider),
          })
        : null;
    return (
      <div
        key={`${event.sourceId}:${event.id}`}
        className={`min-w-0 rounded-md px-2 py-1.5 ${sourceColors[sourceColor(event.sourceId)]}`}
      >
        <button
          type="button"
          onClick={() => {
            setDeleteConfirmation(false);
            setDetail(event);
          }}
          className="w-full min-w-0 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${event.title || t("Untitled event")}, ${eventTime(event, locale, t("All day"))}, ${sourceName(event.sourceId)}`}
        >
          <span
            className={
              compact
                ? "block truncate font-medium"
                : "block break-words text-sm font-medium"
            }
          >
            {event.allDay ? "" : `${eventTime(event, locale, t("All day"))} · `}
            {event.title || t("Untitled event")}
          </span>
          <span className="mt-0.5 block truncate text-[11px]">
            {event.allDay ? `${t("All day")} · ` : ""}
            {sourceName(event.sourceId)}
          </span>
          {personalCalendarStatus ? (
            <span className="mt-0.5 block text-[11px] font-medium">
              {personalCalendarStatus}
            </span>
          ) : null}
        </button>
        {conference ? (
          <div className="mt-1 text-[11px]">
            {conference.status === "ready" && joinUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={agendaText("Unirse a %{provider}", {
                    provider: meetingProvider,
                  })}
                  className="inline-flex items-center gap-1 font-medium underline"
                >
                  {agendaText("Unirse a %{provider}", {
                    provider: meetingProvider,
                  })}
                  <ExternalLink className="size-3" />
                </a>
                {!compact ? <MeetingLinkActions url={joinUrl} /> : null}
              </div>
            ) : (
              <span>
                {conference.status === "pending"
                  ? agendaText("El enlace de la reunión se está preparando.")
                  : conference.status === "unsupported"
                    ? agendaText(
                        "Las videollamadas no son compatibles con esta cuenta de calendario.",
                      )
                    : conference.status === "failed"
                      ? agendaText("No se pudo crear el enlace de la reunión.")
                      : agendaText(
                          "El enlace de la reunión no está disponible.",
                        )}
              </span>
            )}
          </div>
        ) : null}
        {!compact &&
        event.personalEventProvider &&
        event.personalEventId &&
        event.personalConnectionId &&
        agenda.calendarProviders.includes(event.personalEventProvider) &&
        agenda.personalIntegrations?.deleteCalendarEvent ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="mt-1 h-7 px-2 text-[11px]"
            aria-label={agendaText("Delete event from %{provider} · %{title}", {
              provider: sourceName(event.personalEventProvider),
              title: event.title || agendaText("Evento sin título"),
            })}
            onClick={() => {
              setDetail(event);
              setDeleteConfirmation(true);
            }}
          >
            {t("Delete event")}
          </Button>
        ) : null}
      </div>
    );
  }
  function showDay(day: Date) {
    setSelectedDay(day);
    setView("day");
  }
  const currentEvents = eventsForDay(events, selectedDay);
  const useEventDetails =
    Boolean(agenda.personalIntegrations?.listBookingAgenda) ||
    Boolean(agenda.personalIntegrations?.deleteCalendarEvent) ||
    sources.events.length > 0 ||
    events.some((event) => !safeLink(event.webLink));
  const incomplete = Boolean(
    Object.keys(sources.errors).length ||
    agenda.syncError ||
    agenda.bookings.error,
  );
  const detailOccurrence = detail as AgendaOccurrence | null;
  const deletableProvider = detailOccurrence?.personalEventProvider;
  const canDeletePersonalEvent = Boolean(
    detailOccurrence &&
    !detailOccurrence.booking &&
    deletableProvider &&
    detailOccurrence.personalEventId &&
    detailOccurrence.personalConnectionId &&
    agenda.calendarProviders.includes(deletableProvider) &&
    agenda.personalIntegrations?.deleteCalendarEvent,
  );
  async function confirmDeleteEvent() {
    if (
      !detailOccurrence ||
      !canDeletePersonalEvent ||
      !deletableProvider ||
      !detailOccurrence.personalEventId ||
      !detailOccurrence.personalConnectionId
    )
      return;
    const generation = deleteGeneration.current;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await agenda.personalIntegrations!.deleteCalendarEvent!({
        provider: deletableProvider,
        eventId: detailOccurrence.personalEventId,
        connectionId: detailOccurrence.personalConnectionId,
      });
    } catch {
      if (generation !== deleteGeneration.current) return;
      setDeleteError(t("Could not delete this event. Try again."));
      setDeletePending(false);
      return;
    }
    if (generation !== deleteGeneration.current) return;
    const deletedProvider = deletableProvider;
    const deletedEventId = detailOccurrence.personalEventId;
    const deletedConnectionId = detailOccurrence.personalConnectionId;
    agenda.setEvents((current) =>
      current.filter(
        (event) =>
          event.provider !== deletedProvider ||
          event.id !== deletedEventId ||
          event.connectionId !== deletedConnectionId,
      ),
    );
    setDeleteConfirmation(false);
    setDetail(null);
    setDeletePending(false);
    try {
      await agenda.refresh();
    } catch {
      // The provider confirmed deletion; the agenda's normal sync notice handles refresh failures.
    }
  }
  return (
    <div className="@container/calendar min-w-0 space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div
          className="flex min-w-0 flex-1 rounded-lg bg-muted p-1 @min-[28rem]/calendar:flex-none"
          aria-label={t("Calendar view")}
        >
          {(["day", "week", "month"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant={view === mode ? "secondary" : "ghost"}
              size="sm"
              className="h-11 min-w-0 flex-1 px-2 @min-[28rem]/calendar:h-8 @min-[28rem]/calendar:px-3"
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {t(mode === "day" ? "Day" : mode === "week" ? "Week" : "Month")}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 @min-[28rem]/calendar:size-9"
          aria-label={t("Refresh agenda")}
          title={t("Refresh agenda")}
          onClick={() => void agenda.refresh()}
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="size-11 @min-[28rem]/calendar:h-8 @min-[28rem]/calendar:w-auto"
          aria-label={t("Manage calendars")}
          title={t("Manage calendars")}
          onClick={() => setManagerOpen(true)}
        >
          <Settings2 className="size-4" />
          <span className="sr-only @min-[28rem]/calendar:not-sr-only">
            {t("Manage calendars")}
          </span>
        </Button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
        <h3
          className="col-span-2 text-sm font-semibold first-letter:uppercase @min-[28rem]/calendar:col-span-1 @min-[28rem]/calendar:text-base"
          aria-live="polite"
          aria-label={label}
        >
          <span className="@min-[28rem]/calendar:hidden">{compactLabel}</span>
          <span className="hidden @min-[28rem]/calendar:inline">{label}</span>
        </h3>
        <p className="col-start-1 row-start-2 min-w-0 break-words text-xs text-muted-foreground">
          {timeZone.replaceAll("_", " ")}
        </p>
        <div className="col-start-2 row-start-2 flex items-center gap-0.5 @min-[28rem]/calendar:row-span-2 @min-[28rem]/calendar:row-start-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 @min-[28rem]/calendar:size-9"
            aria-label={t("Previous period")}
            onClick={() =>
              setSelectedDay(moveCalendarDate(selectedDay, view, -1))
            }
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 @min-[28rem]/calendar:h-8"
            onClick={() => setSelectedDay(new Date())}
          >
            {t("Today")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 @min-[28rem]/calendar:size-9"
            aria-label={t("Next period")}
            onClick={() =>
              setSelectedDay(moveCalendarDate(selectedDay, view, 1))
            }
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      {Object.entries(sources.errors).map(([id, error]) => (
        <p
          key={id}
          role="alert"
          className="rounded-md bg-muted px-3 py-2 text-sm"
        >
          {id.startsWith("_") ? t("Calendars") : sourceName(id)}: {error}{" "}
          <button
            className="font-medium underline underline-offset-4"
            type="button"
            onClick={() => void sources.refresh()}
          >
            {t("Retry")}
          </button>
        </p>
      ))}
      {agenda.bookings.error ? (
        <p role="alert" className="rounded-md bg-muted px-3 py-2 text-sm">
          {t("Could not load Savia bookings.")}{" "}
          <button
            className="font-medium underline underline-offset-4"
            type="button"
            onClick={() => void agenda.bookings.refresh()}
          >
            {t("Retry")}
          </button>
        </p>
      ) : null}
      {sources.loading || agenda.loading ? (
        <div
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" />
          {t("Loading calendar…")}
        </div>
      ) : null}
      {view === "day" ? (
        incomplete &&
        !currentEvents.length &&
        !sources.loading &&
        !agenda.loading ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 self-start"
            />
            <p className="min-w-0 flex-1">
              {t("Could not check all your calendars.")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11"
              aria-label={t("Sync calendars")}
              onClick={() => void agenda.refresh()}
            >
              {t("Retry")}
            </Button>
          </div>
        ) : useEventDetails ? (
          <div className="space-y-2">
            {currentEvents.length ? (
              currentEvents.map((event) => eventRow(event))
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("No events for this day.")}
              </p>
            )}
          </div>
        ) : (
          legacyDay
        )
      ) : view === "week" ? (
        <div className="grid min-w-0 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-7">
          {days.map((day) => {
            const dayEvents = eventsForDay(events, day);
            return (
              <section
                key={dateKey(day)}
                data-testid="calendar-week-day"
                className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-2 bg-card p-2 md:block md:min-h-64"
              >
                <button
                  type="button"
                  onClick={() => showDay(day)}
                  className={`min-h-11 w-full rounded-md py-1.5 text-left text-sm font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:mb-3 md:min-h-0 ${dateKey(day) === today ? "bg-primary/10 text-primary" : ""}`}
                >
                  {day.toLocaleDateString(locale, { weekday: "long" })}
                  <span className="block tabular-nums">
                    {day.toLocaleDateString(locale, {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </button>
                <div className="min-w-0 space-y-1.5">
                  {dayEvents.some((event) => event.allDay) ? (
                    <div className="space-y-1.5 border-b pb-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("All day")}
                      </p>
                      {dayEvents
                        .filter((event) => event.allDay)
                        .map((event) => eventRow(event))}
                    </div>
                  ) : null}
                  {dayEvents
                    .filter((event) => !event.allDay)
                    .map((event) => eventRow(event))}
                  {!dayEvents.length ? (
                    <p className="py-2 text-xs text-muted-foreground">
                      {t("No events")}
                    </p>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-7 bg-muted/60">
            {Array.from({ length: 7 }, (_, index) =>
              new Date(2026, 9, 5 + index).toLocaleDateString(locale, {
                weekday: "short",
              }),
            ).map((day) => (
              <div
                key={day}
                className="py-2 text-center text-xs font-medium text-muted-foreground"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-border">
            {days.map((day) => {
              const dayEvents = eventsForDay(events, day);
              return (
                <div
                  key={dateKey(day)}
                  className={`min-h-16 min-w-0 bg-card p-1 sm:min-h-36 sm:p-2 ${day.getMonth() !== selectedDay.getMonth() ? "bg-muted/70" : ""}`}
                >
                  <button
                    type="button"
                    aria-label={day.toLocaleDateString(locale, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                    aria-current={dateKey(day) === today ? "date" : undefined}
                    onClick={() => showDay(day)}
                    className={`mb-1 flex min-h-11 w-full items-center justify-center rounded-md text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-7 sm:min-h-0 sm:rounded-full ${dateKey(day) === today ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    {day.getDate()}
                  </button>
                  {dayEvents.length ? (
                    <button
                      type="button"
                      aria-label={t("View %{count} events for %{date}", {
                        count: dayEvents.length,
                        date: day.toLocaleDateString(locale),
                      })}
                      onClick={() => showDay(day)}
                      className="flex min-h-8 w-full flex-col items-center justify-center gap-1 rounded text-xs font-medium tabular-nums hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
                    >
                      <span>{dayEvents.length}</span>
                      <span className="flex gap-0.5" aria-hidden="true">
                        {dayEvents.slice(0, 3).map((event) => (
                          <span
                            key={`${event.sourceId}:${event.id}`}
                            className={`rounded-full p-0.5 ${sourceColors[sourceColor(event.sourceId)]}`}
                          >
                            <span className="block size-1 rounded-full bg-current" />
                          </span>
                        ))}
                      </span>
                    </button>
                  ) : null}
                  <div className="hidden space-y-1 sm:block">
                    {dayEvents
                      .slice(0, 3)
                      .map((event) => eventRow(event, true))}
                    {dayEvents.length > 3 ? (
                      <button
                        type="button"
                        className="w-full rounded px-1 py-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t("View %{count} more events for %{date}", {
                          count: dayEvents.length - 3,
                          date: day.toLocaleDateString(locale),
                        })}
                        onClick={() => showDay(day)}
                      >
                        {t("+%{count} more", { count: dayEvents.length - 3 })}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {managerOpen ? (
        <CalendarSourceManager
          state={sources}
          providers={agenda.calendarProviders}
          timeZone={timeZone}
          onClose={() => setManagerOpen(false)}
        />
      ) : null}
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) {
            if (deletePending) return;
            setDetail(null);
            setDeleteConfirmation(false);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.title || t("Untitled event")}</DialogTitle>
            <DialogDescription>
              {detail ? sourceName(detail.sourceId) : t("Event details")}
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-3 text-sm">
              <p>
                {detail.allDay
                  ? t("All day")
                  : new Date(detail.startsAt).toLocaleString(locale)}
              </p>
              <p>
                {detail.allDay
                  ? allDayPeriod(detail, locale)
                  : t("Until %{date}", {
                      date: new Date(detail.endsAt).toLocaleString(locale),
                    })}
              </p>
              <p className="text-muted-foreground">
                {t("Source time zone: %{zone}", { zone: detail.timeZone })}
              </p>
              {(detail as AgendaOccurrence).conference
                ? (() => {
                    const conference = (detail as AgendaOccurrence).conference!;
                    const joinUrl = safeEventConferenceLink(conference);
                    const providerName =
                      conference.provider === "jitsi"
                        ? "Jitsi"
                        : conference.provider === "zoom"
                          ? agendaText("Zoom")
                          : conference.provider === "google_meet"
                            ? agendaText("Google Meet")
                            : agendaText("Microsoft Teams");
                    return joinUrl ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button asChild variant="outline">
                          <a
                            href={joinUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={agendaText("Unirse a %{provider}", {
                              provider: providerName,
                            })}
                          >
                            {agendaText("Unirse a %{provider}", {
                              provider: providerName,
                            })}
                            <ExternalLink className="size-4" />
                          </a>
                        </Button>
                        <MeetingLinkActions url={joinUrl} />
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        {conference.status === "pending"
                          ? agendaText(
                              "El enlace de la reunión se está preparando.",
                            )
                          : conference.status === "unsupported"
                            ? agendaText(
                                "Las videollamadas no son compatibles con esta cuenta de calendario.",
                              )
                            : conference.status === "failed"
                              ? agendaText(
                                  "No se pudo crear el enlace de la reunión.",
                                )
                              : agendaText(
                                  "El enlace de la reunión no está disponible.",
                                )}
                      </p>
                    );
                  })()
                : null}
              {(detail as AgendaOccurrence).booking ? (
                <BookingDetails
                  booking={(detail as AgendaOccurrence).booking!}
                  t={t}
                />
              ) : null}
              {safeLink(detail.webLink) ? (
                <Button asChild variant="outline">
                  <a
                    href={safeLink(detail.webLink)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("Open in calendar")} <ExternalLink className="size-4" />
                  </a>
                </Button>
              ) : null}
              {canDeletePersonalEvent ? (
                <div className="space-y-2 border-t pt-3">
                  {deleteError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {deleteError}
                    </p>
                  ) : null}
                  {deleteConfirmation ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {t(
                          "This permanently removes the event from your connected calendar.",
                        )}
                      </p>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={deletePending}
                          onClick={() => setDeleteConfirmation(false)}
                        >
                          {t("Cancel")}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={deletePending}
                          onClick={() => void confirmDeleteEvent()}
                        >
                          {deletePending ? t("Deleting…") : t("Confirm delete")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deletePending}
                      onClick={() => setDeleteConfirmation(true)}
                    >
                      {t("Delete event")}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BookingDetails({
  booking,
  t,
}: {
  booking: BookingAgendaEntry;
  t: (
    key: keyof typeof calendarMessages & string,
    params?: MessageParams,
  ) => string;
}) {
  const tenantLink =
    typeof window === "undefined"
      ? null
      : tenantBookingsLink(
          booking.tenantSlug,
          booking.startsAt,
          window.location.hostname,
        );
  return (
    <div className="space-y-1 rounded-md bg-muted/50 p-3">
      <p className="break-words">
        {t("Customer: %{name}", { name: booking.customerName })}
      </p>
      <p className="break-all">
        {t("Customer email: %{email}", { email: booking.customerEmail })}
      </p>
      <p className="break-words">
        {t("Professional: %{name}", { name: booking.professionalName })}
      </p>
      <p className="break-words">
        {t("Tenant: %{name}", { name: booking.tenantName })}
      </p>
      {tenantLink ? (
        <Button asChild variant="link" className="h-auto px-0 py-1">
          <a href={tenantLink}>
            {t("Open bookings in tenant")}
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      ) : null}
    </div>
  );
}
