import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  Settings2,
} from "lucide-react";
import type {
  CalendarColor,
  CalendarOccurrence,
} from "@savia/studio-shared/calendar-contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgendaState } from "./agenda-widget";
import {
  calendarDays,
  addDays,
  dateKey,
  eventsForDay,
  moveCalendarDate,
} from "./calendar-dates";
import { CalendarSourceManager } from "./calendar-source-manager";

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
function eventTime(event: CalendarOccurrence): string {
  return event.allDay
    ? "Todo el día"
    : new Date(event.startsAt).toLocaleTimeString("es", {
        hour: "2-digit",
        minute: "2-digit",
      });
}
function allDayPeriod(event: CalendarOccurrence): string {
  const parseDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const first = parseDate(event.startsAt),
    last = addDays(parseDate(event.endsAt), -1);
  const format = (date: Date) =>
    date.toLocaleDateString("es", {
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
  const [managerOpen, setManagerOpen] = useState(false),
    [detail, setDetail] = useState<CalendarOccurrence | null>(null);
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
    };
    window.addEventListener("savia:identity-changed", reset);
    window.addEventListener("savia:session-cleared", reset);
    return () => {
      window.removeEventListener("savia:identity-changed", reset);
      window.removeEventListener("savia:session-cleared", reset);
    };
  }, []);
  useEffect(() => {
    setDetail(null);
    setManagerOpen(false);
  }, [agenda.personalIntegrations]);
  const events = useMemo(
    () => [
      ...agenda.events
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
                },
              ]
            : [],
        ),
      ...sources.events,
    ],
    [agenda.events, sources.events, sources.preferences, timeZone],
  );
  const days = calendarDays(bounds.start, bounds.end);
  const today = dateKey(new Date());
  const label =
    view === "month"
      ? selectedDay.toLocaleDateString("es", { month: "long", year: "numeric" })
      : view === "week"
        ? `${bounds.start.toLocaleDateString("es", { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}`
        : selectedDay.toLocaleDateString("es", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          });
  const compactLabel =
    view === "day"
      ? selectedDay.toLocaleDateString("es", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : label;
  function sourceName(id: string) {
    return id === "google_calendar"
      ? "Google Calendar"
      : id === "outlook"
        ? "Outlook"
        : (sources.sources.find((source) => source.id === id)?.name ??
          "Calendario");
  }
  function sourceColor(id: string): CalendarColor {
    return id === "google_calendar"
      ? "blue"
      : id === "outlook"
        ? "emerald"
        : (sources.sources.find((source) => source.id === id)?.color ??
          "slate");
  }
  function eventRow(event: CalendarOccurrence, compact = false) {
    return (
      <button
        type="button"
        key={`${event.sourceId}:${event.id}`}
        onClick={() => setDetail(event)}
        className={`w-full min-w-0 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sourceColors[sourceColor(event.sourceId)]}`}
        aria-label={`${event.title || "Evento sin título"}, ${eventTime(event)}, ${sourceName(event.sourceId)}`}
      >
        <span
          className={
            compact
              ? "block truncate font-medium"
              : "block break-words text-sm font-medium"
          }
        >
          {event.allDay ? "" : `${eventTime(event)} · `}
          {event.title || "Evento sin título"}
        </span>
        <span className="mt-0.5 block truncate text-[11px]">
          {event.allDay ? "Todo el día · " : ""}
          {sourceName(event.sourceId)}
        </span>
      </button>
    );
  }
  function showDay(day: Date) {
    setSelectedDay(day);
    setView("day");
  }
  const currentEvents = eventsForDay(events, selectedDay);
  const useEventDetails =
    sources.events.length > 0 ||
    events.some((event) => !safeLink(event.webLink));
  const incomplete = Boolean(
    Object.keys(sources.errors).length || agenda.syncError,
  );
  return (
    <div className="@container/calendar min-w-0 space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div
          className="flex min-w-0 flex-1 rounded-lg bg-muted p-1 @min-[28rem]/calendar:flex-none"
          aria-label="Vista del calendario"
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
              {mode === "day" ? "Día" : mode === "week" ? "Semana" : "Mes"}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="size-11 @min-[28rem]/calendar:h-8 @min-[28rem]/calendar:w-auto"
          aria-label="Gestionar calendarios"
          title="Gestionar calendarios"
          onClick={() => setManagerOpen(true)}
        >
          <Settings2 className="size-4" />
          <span className="sr-only @min-[28rem]/calendar:not-sr-only">
            Gestionar calendarios
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
            aria-label="Periodo anterior"
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
            Hoy
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 @min-[28rem]/calendar:size-9"
            aria-label="Periodo siguiente"
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
          {id.startsWith("_") ? "Calendarios" : sourceName(id)}: {error}{" "}
          <button
            className="font-medium underline underline-offset-4"
            type="button"
            onClick={() => void sources.refresh()}
          >
            Reintentar
          </button>
        </p>
      ))}
      {sources.loading || agenda.loading ? (
        <div
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" />
          Cargando calendario…
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
              No pudimos comprobar todos tus calendarios.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11"
              aria-label="Sincronizar calendarios"
              onClick={() => void agenda.refresh()}
            >
              Reintentar
            </Button>
          </div>
        ) : useEventDetails ? (
          <div className="space-y-2">
            {currentEvents.length ? (
              currentEvents.map((event) => eventRow(event))
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sin eventos para este día.
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
                  {day.toLocaleDateString("es", { weekday: "long" })}
                  <span className="block tabular-nums">
                    {day.toLocaleDateString("es", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </button>
                <div className="min-w-0 space-y-1.5">
                  {dayEvents.some((event) => event.allDay) ? (
                    <div className="space-y-1.5 border-b pb-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Todo el día
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
                      Sin eventos
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
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
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
                    aria-label={day.toLocaleDateString("es", {
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
                      aria-label={`Ver ${dayEvents.length} eventos del ${day.toLocaleDateString("es")}`}
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
                        aria-label={`Ver ${dayEvents.length - 3} eventos más del ${day.toLocaleDateString("es")}`}
                        onClick={() => showDay(day)}
                      >
                        +{dayEvents.length - 3} más
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
          if (!open) setDetail(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.title || "Evento sin título"}</DialogTitle>
            <DialogDescription>
              {detail ? sourceName(detail.sourceId) : "Detalles del evento"}
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-3 text-sm">
              <p>
                {detail.allDay
                  ? "Todo el día"
                  : new Date(detail.startsAt).toLocaleString("es")}
              </p>
              <p>
                {detail.allDay
                  ? allDayPeriod(detail)
                  : `Hasta ${new Date(detail.endsAt).toLocaleString("es")}`}
              </p>
              <p className="text-muted-foreground">
                Zona de origen: {detail.timeZone}
              </p>
              {safeLink(detail.webLink) ? (
                <Button asChild variant="outline">
                  <a
                    href={safeLink(detail.webLink)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir en calendario <ExternalLink className="size-4" />
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
