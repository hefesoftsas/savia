import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ElementType,
  type FormEvent,
} from "react";
import GoogleCalendar from "@thesvg/react/google-calendar";
import MicrosoftOutlook from "@thesvg/react/microsoft-outlook";
import {
  CalendarDays,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { AppServices } from "@/app-services";
import type { PersonalCalendarEvent } from "@/api/personal-integrations-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type CalendarProvider = "google_calendar" | "outlook";
type CalendarEvent = PersonalCalendarEvent & { provider: CalendarProvider };
type CalendarEventGroup = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  events: CalendarEvent[];
};
type CalendarEventLink = {
  provider: CalendarProvider;
  webLink: string;
};
type PendingCalendarTask = {
  title: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
};

const calendarProviderOrder: CalendarProvider[] = [
  "google_calendar",
  "outlook",
];

function isCalendarProvider(value: string): value is CalendarProvider {
  return value === "google_calendar" || value === "outlook";
}

function calendarProviderLabel(provider: CalendarProvider): string {
  return provider === "google_calendar" ? "Google Calendar" : "Outlook";
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfLocalDay(value: Date): Date {
  const end = startOfLocalDay(value);
  end.setDate(end.getDate() + 1);
  return end;
}

function nextHalfHour(value = new Date()): string {
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

function formatDay(value: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(value);
}

function formatTime(value: string | null): string {
  if (!value) return "Sin hora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function secureCalendarLink(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
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

function groupCalendarEvents(events: CalendarEvent[]): CalendarEventGroup[] {
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

function calendarProviderIcon(provider: CalendarProvider): ElementType {
  return provider === "google_calendar" ? GoogleCalendar : MicrosoftOutlook;
}

function CalendarProviderIcon({ provider }: { provider: CalendarProvider }) {
  const Icon = calendarProviderIcon(provider);
  const displayName = calendarProviderLabel(provider);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Logo de ${displayName}`}
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

function feedbackFrom(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "No pudimos sincronizar tus agendas.";
}

export function MyDayPage({
  services,
}: {
  services: Pick<AppServices, "personalIntegrations">;
}) {
  const [day] = useState(() => startOfLocalDay(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarProviders, setCalendarProviders] = useState<
    CalendarProvider[]
  >([]);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState(nextHalfHour);
  const [duration, setDuration] = useState("30");
  const [pendingTask, setPendingTask] = useState<PendingCalendarTask | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const range = useMemo(
    () => ({ from: day.toISOString(), to: endOfLocalDay(day).toISOString() }),
    [day],
  );
  const eventGroups = useMemo(() => groupCalendarEvents(events), [events]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const connections = await services.personalIntegrations.listConnections();
      const connectedCalendars = connections.flatMap((connection) =>
        connection.status === "connected" &&
        isCalendarProvider(connection.provider)
          ? [connection.provider]
          : [],
      );
      setCalendarProviders(connectedCalendars);
      if (connectedCalendars.length === 0) {
        setEvents([]);
        setFeedback(
          "Conecta Google Calendar u Outlook desde Mis integraciones.",
        );
        return;
      }
      const eventsByCalendar = await Promise.all(
        connectedCalendars.map(async (provider) => ({
          provider,
          events: await services.personalIntegrations.listEvents({
            provider,
            ...range,
          }),
        })),
      );
      setEvents(
        sorted(
          eventsByCalendar.flatMap(({ provider, events }) =>
            events.map((event) => ({ ...event, provider })),
          ),
        ),
      );
      setFeedback(null);
    } catch (error) {
      setFeedback(feedbackFrom(error));
    } finally {
      setLoading(false);
    }
  }, [range, services]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function prepareEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startsAt = eventStart(day, time);
    const minutes = Number(duration);
    if (
      !title.trim() ||
      !startsAt ||
      !Number.isInteger(minutes) ||
      minutes < 5
    ) {
      setFeedback(
        "Indica una tarea, una hora válida y una duración de al menos 5 minutos.",
      );
      return;
    }
    if (calendarProviders.length === 0) {
      setFeedback("Conecta Google Calendar u Outlook desde Mis integraciones.");
      return;
    }
    const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
    const cleanTitle = title.trim();
    setPendingTask({
      title: cleanTitle,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      minutes,
    });
  }

  async function createEvent() {
    if (!pendingTask) return;
    setCreating(true);
    setFeedback(null);
    try {
      const results = await Promise.all(
        calendarProviders.map(async (provider) => {
          try {
            return {
              provider,
              event: await services.personalIntegrations.createCalendarEvent({
                provider,
                title: pendingTask.title,
                startsAt: pendingTask.startsAt,
                endsAt: pendingTask.endsAt,
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
        setFeedback("No pudimos crear la tarea en tus calendarios conectados.");
        return;
      }
      setEvents((current) => sorted([...current, ...created]));
      setTitle("");
      const successfulNames = created
        .map(({ provider }) => calendarProviderLabel(provider))
        .join(" y ");
      setFeedback(
        failedProviders.length > 0
          ? `La tarea quedó creada en ${successfulNames}. No se pudo crear en ${failedProviders.map(calendarProviderLabel).join(" y ")}.`
          : `La tarea quedó creada en ${successfulNames}.`,
      );
    } finally {
      setCreating(false);
      setPendingTask(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4 py-6">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <CalendarDays className="size-4" />
            {calendarProviders.length > 0
              ? calendarProviders.map(calendarProviderLabel).join(" y ")
              : "Calendarios personales"}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Mi día</h1>
          <p className="mt-2 text-sm capitalize text-muted-foreground">
            {formatDay(day)}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading || creating}
          onClick={() => void refresh()}
        >
          {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          Sincronizar
        </Button>
      </header>

      {feedback ? (
        <Alert className="mb-5" aria-label={feedback}>
          <CircleAlert />
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Agenda</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div
                role="status"
                aria-live="polite"
                aria-label="Cargando agenda…"
                className="space-y-3"
              >
                <span className="sr-only">Cargando agenda…</span>
                <div className="divide-y rounded-lg border">
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
            ) : eventGroups.length === 0 ? (
              <div
                className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center"
                data-testid="my-day-agenda-empty"
              >
                <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
                  <CalendarDays
                    aria-hidden="true"
                    className="size-7 text-primary"
                  />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-foreground">
                  Sin eventos para hoy
                </h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  Tu agenda está libre. Crea una tarea para bloquear tiempo en
                  tu calendario.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-6"
                  onClick={() =>
                    document.getElementById("my-day-task")?.focus({
                      preventScroll: false,
                    })
                  }
                >
                  Agregar tarea
                </Button>
              </div>
            ) : (
              <ul className="divide-y rounded-lg border">
                {eventGroups.map((group) => {
                  const linkedCalendars = groupCalendarLinks(group);
                  const linkedCalendar = linkedCalendars[0];
                  const providers = groupProviders(group);
                  return (
                    <li
                      key={group.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3"
                    >
                      <span className="min-w-24 text-sm font-medium tabular-nums text-muted-foreground">
                        {formatTime(group.startsAt)}
                      </span>
                      <div className="min-w-44 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{group.title}</p>
                          <div
                            aria-label={`Agendada en ${providers.map(calendarProviderLabel).join(" y ")}`}
                            className="flex items-center gap-1"
                          >
                            {providers.map((provider) => (
                              <CalendarProviderIcon
                                key={provider}
                                provider={provider}
                              />
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Hasta {formatTime(group.endsAt)}
                        </p>
                      </div>
                      {linkedCalendars.length > 1 ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto gap-1 px-0 py-0"
                              aria-label="Ver en calendario"
                            >
                              Ver <ExternalLink className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {linkedCalendars.map(({ provider, webLink }) => {
                              const Icon = calendarProviderIcon(provider);
                              return (
                                <DropdownMenuItem asChild key={provider}>
                                  <a
                                    aria-label={`Abrir en ${calendarProviderLabel(provider)}`}
                                    href={webLink}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <Icon
                                      aria-hidden="true"
                                      className="size-4"
                                    />
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
                          aria-label={`Ver en ${calendarProviderLabel(linkedCalendar.provider)}`}
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                          href={linkedCalendar.webLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver <ExternalLink className="size-3.5" />
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Enlace no disponible
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Agregar tarea</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={prepareEvent}>
              <div className="space-y-2">
                <Label htmlFor="my-day-task">Tarea</Label>
                <Input
                  id="my-day-task"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ej. Preparar propuesta"
                  maxLength={2000}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="my-day-time">Hora</Label>
                <Input
                  id="my-day-time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="my-day-duration">Duración (minutos)</Label>
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
              <Button
                className="w-full"
                type="submit"
                disabled={creating || calendarProviders.length === 0}
              >
                {creating ? <LoaderCircle className="animate-spin" /> : null}
                Crear tarea
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={pendingTask !== null}
        onOpenChange={(open) => {
          if (!open && !creating) setPendingTask(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar tarea</DialogTitle>
            <DialogDescription>
              Crearás “{pendingTask?.title}” de{" "}
              {formatTime(pendingTask?.startsAt ?? null)} a{" "}
              {formatTime(pendingTask?.endsAt ?? null)} durante{" "}
              {pendingTask?.minutes ?? 0} minutos en{" "}
              {calendarProviders.map(calendarProviderLabel).join(" y ")}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingTask(null)}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void createEvent()}
              disabled={creating}
            >
              {creating ? <LoaderCircle className="animate-spin" /> : null}
              Confirmar creación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
