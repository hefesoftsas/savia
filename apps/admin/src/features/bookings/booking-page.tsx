import { RouteLoading } from "@/components/admin/route-loading";
import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { ResponsiveActionButton } from "@/components/ui/responsive-action-button";
import { Plus, RefreshCw, Save, Trash2, Unplug, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAppLocale, useMessages } from "@/i18n/core";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { bookingMessages } from "./booking-messages";

import type { Period, Exception, Settings } from "./booking-types";
import { BookingSetupWizard, WeeklyHoursEditor } from "./booking-setup-wizard";
import { BookingPublicLinksPanel } from "./booking-public-links-panel";
import {
  BookingConference,
  type BookingConferenceState,
} from "./booking-conference";
type Bootstrap = {
  settings: Settings;
  candidates: Array<{ principalId: string; displayName: string }>;
  canManage: boolean;
  principalId: string;
  publicUrl: string | null;
  calendar: { provider: null | "google_calendar" | "outlook"; status: string };
  agenda?: { enabled: boolean; sourceCount: number };
};
type Reservation = {
  id: string;
  serviceId: string;
  professionalId: string;
  serviceName: string;
  professionalName: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
  customerEmail: string;
  status: "confirmed" | "cancelled";
  version: number;
  deliveryStatus: string;
  calendarStatus: string;
  canGenerateConference?: boolean;
  conference?: BookingConferenceState;
};
type Tab = "settings" | "availability" | "reservations" | "sharing";

const defaultWeekly = (): Period[] => [];
function isConflict(error: unknown) {
  return error instanceof ApiClientError
    ? error.status === 409 || error.code === "VERSION_CONFLICT"
    : Boolean(
        error &&
        typeof error === "object" &&
        (("status" in error && error.status === 409) ||
          ("code" in error && error.code === "VERSION_CONFLICT")),
      );
}

function displayTime(iso: string, zone: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function BookingPage({
  services,
  tenantId,
}: {
  services: Pick<AppServices, "apiClient">;
  tenantId: number;
}) {
  const t = useMessages(bookingMessages);
  const locale = useAppLocale();
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [loadedTenant, setLoadedTenant] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab: Tab =
    searchParams.get("tab") === "reservations" ? "reservations" : "settings";
  const [tab, setTab] = useState<Tab>(requestedTab);
  const dateParam = searchParams.get("date");
  const appointmentDate =
    dateParam &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateParam) &&
    Number.isFinite(Date.parse(dateParam)) &&
    new Date(dateParam).toISOString().slice(0, 10) === dateParam
      ? dateParam
      : null;
  const [settings, setSettings] = useState<Settings>();
  const [weekly, setWeekly] = useState<Period[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [exceptionDate, setExceptionDate] = useState("");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationsLoading, setReservationsLoading] = useState(false);
  const [reservationsAttempt, setReservationsAttempt] = useState(0);
  const [cancellingId, setCancellingId] = useState("");
  const [generatingConferenceId, setGeneratingConferenceId] = useState("");
  const ready = !!bootstrap && loadedTenant === tenantId;
  const currentProfessional = useMemo(
    () =>
      bootstrap?.settings.professionals.find(
        (item) => item.principalId === bootstrap.principalId,
      ),
    [bootstrap],
  );
  const linkProfessional = useMemo(
    () =>
      bootstrap?.settings.professionals.find(
        (item) =>
          item.principalId === bootstrap.principalId &&
          item.enabled &&
          bootstrap.settings.enabled &&
          bootstrap.settings.published &&
          bootstrap.candidates.some(
            (candidate) => candidate.principalId === item.principalId,
          ) &&
          bootstrap.settings.services.some(
            (service) =>
              service.enabled && service.professionalIds.includes(item.id),
          ),
      ),
    [bootstrap],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setNotice("");
    setBootstrap(undefined);
    setSettings(undefined);
    setReservations([]);
    setLoadedTenant(undefined);
    setTab(requestedTab);
    void services.apiClient
      .get<{ data: Bootstrap }>(`/v1/tenants/${tenantId}/booking`)
      .then(({ data }) => {
        if (!active) return;
        setBootstrap(data);
        setSettings(data.settings);
        setLoadedTenant(tenantId);
      })
      .catch(() => {
        if (active) setError(t("Booking settings could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId, services.apiClient, attempt, t, requestedTab]);

  useEffect(() => {
    if (tab !== "reservations" || !ready) return;
    let active = true;
    setReservationsLoading(true);
    setError("");
    const from = appointmentDate
      ? new Date(`${appointmentDate}T00:00:00`)
      : new Date();
    const to = new Date(from);
    if (appointmentDate) to.setDate(to.getDate() + 1);
    else
      to.setTime(
        from.getTime() +
          Math.min(90, Math.max(1, settings?.horizonDays ?? 30)) * 86400000,
      );
    void services.apiClient
      .get<{ data: Reservation[] }>(
        `/v1/tenants/${tenantId}/booking/reservations?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      )
      .then(({ data }) => {
        if (active) setReservations(data);
      })
      .catch(() => {
        if (active) setError(t("Reservations could not be loaded."));
      })
      .finally(() => {
        if (active) setReservationsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    tab,
    ready,
    tenantId,
    services.apiClient,
    reservationsAttempt,
    settings?.horizonDays,
    appointmentDate,
    t,
  ]);

  async function saveSettings(settings: Settings) {
    if (
      settings.published &&
      (!settings.enabled ||
        !settings.services.some(
          (service) =>
            service.enabled &&
            service.professionalIds.some((id) =>
              settings.professionals.some(
                (professional) =>
                  professional.id === id && professional.enabled,
              ),
            ),
        ))
    ) {
      setNotice("");
      setError(
        t("Enable a service and an assigned professional before publishing."),
      );
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await services.apiClient.put<{ data: Bootstrap }>(
        `/v1/tenants/${tenantId}/booking`,
        settings,
      );
      const next = result.data;
      setBootstrap(next);
      setSettings(next.settings);
      setNotice(t("Booking settings saved."));
    } catch (exception) {
      setError(
        isConflict(exception)
          ? t("Booking settings changed elsewhere. Reload before saving again.")
          : exception instanceof ApiClientError
            ? t(
                "Booking settings could not be saved (HTTP %{status}): %{message}",
                {
                  status: exception.status,
                  message: Object.prototype.hasOwnProperty.call(
                    bookingMessages,
                    exception.message,
                  )
                    ? t(exception.message as keyof typeof bookingMessages)
                    : exception.message,
                },
              )
            : t(
                "Booking settings could not be saved. Check your connection and retry.",
              ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveAvailability(event: FormEvent) {
    event.preventDefault();
    if (!bootstrap || !settings) return;
    const target = bootstrap.canManage
      ? settings.professionals.find((item) => item.id === selectedProfessional)
      : currentProfessional;
    if (!target) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = bootstrap.canManage
        ? await services.apiClient.put<{ data: Bootstrap }>(
            `/v1/tenants/${tenantId}/booking`,
            {
              ...settings,
              professionals: settings.professionals.map((professional) =>
                professional.id === target.id
                  ? { ...professional, weekly, exceptions }
                  : professional,
              ),
            },
          )
        : await services.apiClient.put<{ data: Bootstrap }>(
            `/v1/tenants/${tenantId}/booking/availability`,
            { weekly, exceptions, version: settings.version },
          );
      setBootstrap(result.data);
      setSettings(result.data.settings);
      setNotice(t("Availability saved."));
    } catch (exception) {
      setError(
        isConflict(exception)
          ? t("Booking settings changed elsewhere. Reload before saving again.")
          : t("Availability could not be saved. Reload and retry."),
      );
    } finally {
      setSaving(false);
    }
  }

  const [selectedProfessional, setSelectedProfessional] = useState("");
  useEffect(() => {
    if (!bootstrap) return;
    const existing = bootstrap.settings.professionals.find(
      (item) => item.id === selectedProfessional,
    );
    const owned = bootstrap.settings.professionals.find(
      (item) => item.principalId === bootstrap.principalId,
    );
    setSelectedProfessional(
      existing?.id ??
        owned?.id ??
        bootstrap.settings.professionals[0]?.id ??
        "",
    );
  }, [bootstrap, selectedProfessional]);
  const scheduleProfessional = bootstrap?.canManage
    ? settings?.professionals.find((item) => item.id === selectedProfessional)
    : currentProfessional;

  useEffect(() => {
    setWeekly(scheduleProfessional?.weekly ?? defaultWeekly());
    setExceptions(scheduleProfessional?.exceptions ?? []);
  }, [scheduleProfessional]);

  function editExceptionPeriod(
    date: string,
    index: number,
    field: "start" | "end",
    value: string,
  ) {
    setExceptions((current) =>
      current.map((exception) => {
        if (exception.date !== date) return exception;
        const periods = [...exception.periods];
        if (!value) periods.splice(index, 1);
        else if (periods[index])
          periods[index] = { ...periods[index], [field]: value };
        else
          periods[index] = {
            start: field === "start" ? value : "09:00",
            end: field === "end" ? value : "17:00",
          };
        return { ...exception, periods };
      }),
    );
  }

  function addExceptionPeriod(date: string) {
    setExceptions((current) =>
      current.map((exception) =>
        exception.date === date && exception.periods.length < 4
          ? {
              ...exception,
              periods: [...exception.periods, { start: "09:00", end: "17:00" }],
            }
          : exception,
      ),
    );
  }

  async function changeCalendar(
    provider: null | "google_calendar" | "outlook",
  ) {
    if (!bootstrap) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await services.apiClient.put<{ data: Bootstrap }>(
        `/v1/tenants/${tenantId}/booking/calendar`,
        { provider },
      );
      setBootstrap(result.data);
      setSettings(result.data.settings);
      setNotice(t("Availability saved."));
    } catch {
      setError(t("Availability could not be saved. Reload and retry."));
    } finally {
      setSaving(false);
    }
  }

  async function changeMyDayAccess(enabled: boolean) {
    if (!bootstrap) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await services.apiClient.put<{ data: Bootstrap }>(
        `/v1/tenants/${tenantId}/booking/agenda`,
        { enabled },
      );
      setBootstrap(result.data);
      setSettings(result.data.settings);
      setNotice(
        t(
          enabled
            ? "My Day availability access updated."
            : "My Day availability access stopped.",
        ),
      );
    } catch {
      setError(
        t(
          "My Day availability could not be updated. Check your connection and retry.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancelReservation(reservation: Reservation) {
    setCancellingId(reservation.id);
    setError("");
    setNotice("");
    try {
      const result = await services.apiClient.post<{ data: Reservation }>(
        `/v1/tenants/${tenantId}/booking/reservations/${encodeURIComponent(reservation.id)}/cancel`,
        { version: reservation.version },
      );
      setReservations((current) =>
        current.map((item) =>
          item.id === reservation.id ? result.data : item,
        ),
      );
      setNotice(t("Reservation cancelled."));
    } catch {
      setError(t("Reservation could not be cancelled. Refresh and retry."));
    } finally {
      setCancellingId("");
    }
  }

  async function generateConference(reservation: Reservation) {
    setGeneratingConferenceId(reservation.id);
    setError("");
    setNotice("");
    try {
      const result = await services.apiClient.post<{ data: Reservation }>(
        `/v1/tenants/${tenantId}/booking/reservations/${encodeURIComponent(reservation.id)}/conference`,
        { version: reservation.version },
      );
      setReservations((current) =>
        current.map((item) =>
          item.id === reservation.id ? result.data : item,
        ),
      );
      setNotice(
        t("Video meeting link is being prepared. Refresh to check again."),
      );
    } catch {
      setError(
        t(
          "Video meeting link request failed. Check the calendar connection and retry.",
        ),
      );
    } finally {
      setGeneratingConferenceId("");
    }
  }

  if (!ready)
    return (
      <main
        className="mx-auto grid max-w-5xl gap-5 px-4 py-8 md:px-6"
        aria-busy={loading}
      >
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <RouteLoading label={t("Loading booking settings…")} />
        )}
        {error && (
          <ResponsiveActionButton
            icon={RefreshCw}
            type="button"
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("Retry")}
          </ResponsiveActionButton>
        )}
      </main>
    );

  const tZone = settings?.timeZone ?? "UTC";
  const publicReady =
    bootstrap.settings.enabled && bootstrap.settings.published;
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {settings?.title || t("Appointments")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Manage appointments and your availability.")}
          </p>
        </div>
        {publicReady && bootstrap.publicUrl && bootstrap.canManage && (
          <a
            className="text-sm font-medium underline underline-offset-4"
            href={bootstrap.publicUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t("Open team booking page")}
          </a>
        )}
      </header>

      <nav
        aria-label={t("Booking settings")}
        className="grid grid-cols-2 gap-1 border-b pb-2 sm:flex sm:flex-wrap sm:gap-2"
      >
        {(["settings", "availability", "reservations", "sharing"] as const).map(
          (value) => (
            <Button
              key={value}
              type="button"
              className="min-h-11 h-auto min-w-0 whitespace-normal px-2 py-3 sm:px-4"
              variant={tab === value ? "secondary" : "ghost"}
              aria-current={tab === value ? "page" : undefined}
              onClick={() => {
                setTab(value);
                setError("");
                setNotice("");
              }}
            >
              {t(
                value === "settings"
                  ? "Booking settings"
                  : value === "availability"
                    ? "Availability"
                    : value === "reservations"
                      ? "Reservations"
                      : "Booking links",
              )}
            </Button>
          ),
        )}
      </nav>

      {notice && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {tab === "settings" && bootstrap.canManage && settings && (
        <BookingSetupWizard
          key={tenantId}
          settings={settings}
          candidates={bootstrap.candidates ?? []}
          onChange={setSettings}
          onSave={saveSettings}
          onReset={() => setSettings(bootstrap.settings)}
          saving={saving}
          publicUrl={publicReady ? bootstrap.publicUrl : null}
        />
      )}

      {tab === "settings" && bootstrap.canManage && !publicReady && (
        <p className="text-sm text-muted-foreground">
          {t("Save enabled and published settings to open the public page.")}
        </p>
      )}

      {tab === "settings" && !bootstrap.canManage && (
        <section className="grid max-w-2xl gap-2">
          <h2 className="text-lg font-semibold">{t("Your availability")}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "Edit weekly hours and date-specific exceptions. Times use %{timeZone}.",
              { timeZone: tZone },
            )}
          </p>
          <Button type="button" onClick={() => setTab("availability")}>
            {t("Availability")}
          </Button>
        </section>
      )}

      {tab === "sharing" && settings && (
        <BookingPublicLinksPanel
          tenantId={String(tenantId)}
          currentProfessionalId={linkProfessional?.id ?? null}
          currentProfessionalName={
            bootstrap.candidates.find(
              (candidate) =>
                candidate.principalId === linkProfessional?.principalId,
            )?.displayName
          }
          canManageTeamLinks={bootstrap.canManage}
          apiClient={services.apiClient}
          services={settings.services
            .filter((service) => service.enabled)
            .map(({ id, name }) => ({ id, name }))}
        />
      )}

      {tab === "availability" && (
        <section className="grid max-w-4xl gap-5">
          <div>
            <h2 className="text-lg font-semibold">{t("Your availability")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Edit weekly hours and date-specific exceptions. Times use %{timeZone}.",
                { timeZone: tZone },
              )}
            </p>
          </div>
          {bootstrap.canManage && (
            <label className="grid max-w-md gap-1.5 text-sm">
              {t("Professional")}
              <select
                className="h-9 min-w-0 max-w-full rounded-md border bg-background px-3 max-sm:h-11"
                value={selectedProfessional}
                onChange={(event) =>
                  setSelectedProfessional(event.target.value)
                }
              >
                {settings?.professionals.map((professional) => (
                  <option key={professional.id} value={professional.id}>
                    {bootstrap.candidates.find(
                      (candidate) =>
                        candidate.principalId === professional.principalId,
                    )?.displayName ?? professional.principalId}
                  </option>
                ))}
              </select>
            </label>
          )}
          {scheduleProfessional ? (
            <form className="grid gap-5" onSubmit={saveAvailability}>
              <WeeklyHoursEditor
                value={weekly}
                onChange={setWeekly}
                disabled={saving}
              />
              <fieldset className="grid gap-3">
                <legend className="text-base font-semibold">
                  {t("Exceptions")}
                </legend>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid gap-1.5 text-sm">
                    {t("Exception date")}
                    <Input
                      type="date"
                      value={exceptionDate}
                      onChange={(event) => setExceptionDate(event.target.value)}
                    />
                  </label>
                  <ResponsiveActionButton
                    icon={Plus}
                    type="button"
                    variant="outline"
                    disabled={
                      !exceptionDate ||
                      exceptions.some((item) => item.date === exceptionDate)
                    }
                    onClick={() => {
                      setExceptions((items) =>
                        [...items, { date: exceptionDate, periods: [] }].sort(
                          (a, b) => a.date.localeCompare(b.date),
                        ),
                      );
                      setExceptionDate("");
                    }}
                  >
                    {t("Add exception")}
                  </ResponsiveActionButton>
                </div>
                {exceptions.map((exception) => (
                  <div
                    key={exception.date}
                    className="grid gap-3 rounded-lg border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{exception.date}</strong>
                      <div className="flex gap-2">
                        <ResponsiveActionButton
                          icon={Plus}
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={exception.periods.length >= 4}
                          onClick={() => addExceptionPeriod(exception.date)}
                        >
                          {t("Add period")}
                        </ResponsiveActionButton>
                        <ResponsiveActionButton
                          icon={Trash2}
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setExceptions((items) =>
                              items.filter(
                                (item) => item.date !== exception.date,
                              ),
                            )
                          }
                        >
                          {t("Remove exception")}
                        </ResponsiveActionButton>
                      </div>
                    </div>
                    {(exception.periods.length
                      ? exception.periods
                      : [{ start: "", end: "" }]
                    ).map((period, index) => (
                      <div
                        key={`${exception.date}-${index}`}
                        className="grid gap-2 sm:grid-cols-3"
                      >
                        <label className="grid gap-1 text-sm">
                          {t("Start")}
                          <Input
                            aria-label={`${exception.date} ${t("Start")} ${index + 1}`}
                            type="time"
                            step={300}
                            value={period.start}
                            onChange={(event) =>
                              editExceptionPeriod(
                                exception.date,
                                index,
                                "start",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-sm">
                          {t("End")}
                          <Input
                            aria-label={`${exception.date} ${t("End")} ${index + 1}`}
                            type="time"
                            step={300}
                            value={period.end}
                            onChange={(event) =>
                              editExceptionPeriod(
                                exception.date,
                                index,
                                "end",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        {exception.periods.length > 1 && (
                          <ResponsiveActionButton
                            icon={Trash2}
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setExceptions((items) =>
                                items.map((item) =>
                                  item.date === exception.date
                                    ? {
                                        ...item,
                                        periods: item.periods.filter(
                                          (_, periodIndex) =>
                                            periodIndex !== index,
                                        ),
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            {t("Remove period")}
                          </ResponsiveActionButton>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </fieldset>
              <ResponsiveActionButton
                icon={Save}
                type="submit"
                disabled={saving}
              >
                {saving
                  ? t("Loading booking settings…")
                  : t("Save availability")}
              </ResponsiveActionButton>
            </form>
          ) : (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">
              {t("Select a Savia member")}
            </p>
          )}
          {currentProfessional && (
            <section
              className="grid gap-3 rounded-lg border p-4"
              aria-labelledby="calendar-heading"
            >
              <h3 id="calendar-heading" className="font-semibold">
                {t("Calendar connection")}
              </h3>
              <p className="max-w-3xl text-sm text-muted-foreground">
                {t(
                  "Choose a personal calendar to check availability and create events. Calendar access is optional and only granted by you.",
                )}
              </p>
              <p className="text-sm" role="status">
                {bootstrap.calendar.provider === "google_calendar"
                  ? bootstrap.calendar.status === "connected"
                    ? t("Google Calendar connected")
                    : t("Calendar needs reconnection")
                  : bootstrap.calendar.provider === "outlook"
                    ? bootstrap.calendar.status === "connected"
                      ? t("Outlook Calendar connected")
                      : t("Calendar needs reconnection")
                    : t("Calendar not connected")}
              </p>
              {bootstrap.calendar.provider &&
                bootstrap.calendar.status !== "connected" && (
                  <p className="text-sm text-destructive">
                    {bootstrap.calendar.status}
                  </p>
                )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void changeCalendar("google_calendar")}
                  className="max-sm:min-h-11"
                >
                  {t("Choose calendar")}: Google
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void changeCalendar("outlook")}
                  className="max-sm:min-h-11"
                >
                  {t("Choose calendar")}: Outlook
                </Button>
                {bootstrap.calendar.provider && (
                  <ResponsiveActionButton
                    icon={Unplug}
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void changeCalendar(null)}
                  >
                    {t("Calendar not connected")}
                  </ResponsiveActionButton>
                )}
                <Link
                  className="self-center text-sm underline underline-offset-4"
                  to="/my-integrations?tab=connections"
                >
                  {t("Choose calendar")}
                </Link>
              </div>
            </section>
          )}
          {currentProfessional && (
            <section
              className="grid gap-3 rounded-lg border p-4"
              aria-labelledby="my-day-heading"
            >
              <h3 id="my-day-heading" className="font-semibold">
                {t("My Day availability")}
              </h3>
              <p className="max-w-3xl text-sm text-muted-foreground">
                {t(
                  "Grant access to busy times in your current Google or Outlook calendar and imported or subscribed calendars. Meeting details stay private.",
                )}
              </p>
              <p className="text-sm" role="status">
                {bootstrap.agenda?.enabled
                  ? t("My Day access is enabled. Calendar sources: %{count}.", {
                      count: bootstrap.agenda.sourceCount,
                    })
                  : t("My Day access is off.")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void changeMyDayAccess(true)}
                  className="h-auto min-h-11 max-w-full whitespace-normal text-left"
                >
                  {saving
                    ? t("Loading booking settings…")
                    : bootstrap.agenda?.enabled
                      ? t("Update calendar access")
                      : t("Use My Day to block busy times")}
                </Button>
                {bootstrap.agenda?.enabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void changeMyDayAccess(false)}
                    className="h-auto min-h-11 max-w-full whitespace-normal text-left"
                  >
                    {t("Stop using My Day")}
                  </Button>
                )}
              </div>
            </section>
          )}
        </section>
      )}

      {tab === "reservations" && (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("Reservations")}</h2>
            <ResponsiveActionButton
              icon={RefreshCw}
              type="button"
              variant="outline"
              onClick={() => setReservationsAttempt((value) => value + 1)}
            >
              {t("Retry")}
            </ResponsiveActionButton>
          </div>
          {appointmentDate && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="text-muted-foreground">
                {t("Reservations for %{date}", {
                  date: new Intl.DateTimeFormat(locale, {
                    dateStyle: "long",
                  }).format(new Date(`${appointmentDate}T00:00:00`)),
                })}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.delete("date");
                    return next;
                  })
                }
              >
                {t("Show upcoming reservations")}
              </Button>
            </div>
          )}
          {reservationsLoading ? (
            <div role="status" className="grid gap-2">
              <span className="sr-only">{t("Reservations")}</span>
              <div className="h-10 animate-pulse rounded bg-muted" />
              <div className="h-16 animate-pulse rounded bg-muted" />
            </div>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : reservations.length === 0 ? (
            <p className="rounded-lg border p-6 text-sm text-muted-foreground">
              {t("No reservations in this period.")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[54rem] text-left text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    {[
                      "Appointment time",
                      "Service",
                      "Professional",
                      "Customer",
                      "Status",
                      "Delivery",
                      "Calendar",
                      "",
                    ].map((label, index) => (
                      <th key={label || index} className="p-3 font-medium">
                        {label ? t(label as keyof typeof bookingMessages) : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((reservation) => (
                    <tr key={reservation.id} className="border-t align-top">
                      <td className="whitespace-nowrap p-3">
                        {displayTime(reservation.startsAt, tZone, locale)}
                        <br />
                        <span className="text-muted-foreground">
                          {displayTime(reservation.endsAt, tZone, locale)}
                        </span>
                        {reservation.conference && (
                          <div className="mt-2 whitespace-normal">
                            <BookingConference
                              conference={reservation.conference}
                              status={reservation.status}
                            />
                          </div>
                        )}
                      </td>
                      <td className="p-3">{reservation.serviceName}</td>
                      <td className="p-3">{reservation.professionalName}</td>
                      <td className="p-3">
                        {reservation.customerName}
                        <br />
                        <span className="text-muted-foreground">
                          {reservation.customerEmail}
                        </span>
                      </td>
                      <td className="p-3">
                        {t(
                          reservation.status === "confirmed"
                            ? "Confirmed"
                            : "Cancelled",
                        )}
                      </td>
                      <td
                        className={
                          /fail|error/i.test(reservation.deliveryStatus)
                            ? "p-3 text-destructive"
                            : "p-3"
                        }
                      >
                        {reservation.deliveryStatus}
                      </td>
                      <td
                        className={
                          /fail|error/i.test(reservation.calendarStatus)
                            ? "p-3 text-destructive"
                            : "p-3"
                        }
                      >
                        {reservation.calendarStatus}
                      </td>
                      <td className="p-3">
                        {reservation.status === "confirmed" &&
                          reservation.conference?.status !== "ready" &&
                          reservation.conference?.status !== "pending" &&
                          reservation.conference?.status !== "unsupported" && (
                            <div className="mb-2 grid justify-items-start gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={
                                  !reservation.canGenerateConference ||
                                  generatingConferenceId === reservation.id
                                }
                                onClick={() =>
                                  void generateConference(reservation)
                                }
                              >
                                {generatingConferenceId === reservation.id
                                  ? t("Generating video link…")
                                  : t("Generate video link")}
                              </Button>
                              {!reservation.canGenerateConference && (
                                <span className="max-w-48 text-xs text-muted-foreground">
                                  {t(
                                    "Connect an eligible Google Calendar or Outlook calendar to generate a video link.",
                                  )}
                                </span>
                              )}
                            </div>
                          )}
                        {reservation.status === "confirmed" && (
                          <ResponsiveActionButton
                            icon={XCircle}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={cancellingId === reservation.id}
                            onClick={() => void cancelReservation(reservation)}
                          >
                            {cancellingId === reservation.id
                              ? t("Loading booking settings…")
                              : t("Cancel reservation")}
                          </ResponsiveActionButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
