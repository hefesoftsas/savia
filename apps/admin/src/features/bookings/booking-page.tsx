import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAppLocale, useMessages } from "@/i18n/core";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { bookingMessages } from "./booking-messages";

type Period = { day: number; start: string; end: string };
type Exception = {
  date: string;
  periods: Array<{ start: string; end: string }>;
};
type Professional = {
  id: string;
  principalId: string;
  enabled: boolean;
  weekly: Period[];
  exceptions: Exception[];
};
type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  bufferMinutes: number;
  enabled: boolean;
  professionalIds: string[];
};
type Settings = {
  version: number;
  enabled: boolean;
  published: boolean;
  title: string;
  description: string;
  timeZone: string;
  leadMinutes: number;
  horizonDays: number;
  cancellationMinutes: number;
  reminderMinutes: number;
  services: Service[];
  professionals: Professional[];
};
type Bootstrap = {
  settings: Settings;
  candidates: Array<{ principalId: string; displayName: string }>;
  canManage: boolean;
  principalId: string;
  publicUrl: string | null;
  calendar: { provider: null | "google_calendar" | "outlook"; status: string };
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
};
type Tab = "settings" | "availability" | "reservations";

const weekdays = [1, 2, 3, 4, 5, 6, 0] as const;
const weekdayKeys = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const timeZones = [
  "America/Bogota",
  "America/Lima",
  "America/Mexico_City",
  "America/New_York",
  "Europe/London",
  "Europe/Lisbon",
  "UTC",
];
const defaultWeekly = (): Period[] => [];
function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes
    .map(
      (value, index) =>
        `${[4, 6, 8, 10].includes(index) ? "-" : ""}${value.toString(16).padStart(2, "0")}`,
    )
    .join("");
}

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
  const [tab, setTab] = useState<Tab>("settings");
  const [settings, setSettings] = useState<Settings>();
  const [weekly, setWeekly] = useState<Period[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [exceptionDate, setExceptionDate] = useState("");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationsLoading, setReservationsLoading] = useState(false);
  const [reservationsAttempt, setReservationsAttempt] = useState(0);
  const [cancellingId, setCancellingId] = useState("");
  const ready = !!bootstrap && loadedTenant === tenantId;
  const currentProfessional = useMemo(
    () =>
      bootstrap?.settings.professionals.find(
        (item) => item.principalId === bootstrap.principalId,
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
    setTab("settings");
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
  }, [tenantId, services.apiClient, attempt, t]);

  useEffect(() => {
    if (tab !== "reservations" || !ready) return;
    let active = true;
    setReservationsLoading(true);
    setError("");
    const from = new Date();
    const to = new Date(
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
    t,
  ]);

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }

  function updateService(index: number, patch: Partial<Service>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            services: current.services.map((service, i) =>
              i === index ? { ...service, ...patch } : service,
            ),
          }
        : current,
    );
  }

  function updateProfessional(index: number, patch: Partial<Professional>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            professionals: current.professionals.map((professional, i) =>
              i === index ? { ...professional, ...patch } : professional,
            ),
          }
        : current,
    );
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
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

  function editPeriod(
    day: number,
    index: number,
    field: "start" | "end",
    value: string,
  ) {
    setWeekly((current) => {
      const rest = current.filter((period) => period.day !== day);
      const periods = current.filter((period) => period.day === day);
      if (!value) periods.splice(index, 1);
      else if (periods[index])
        periods[index] = { ...periods[index], [field]: value };
      else
        periods[index] = {
          day,
          start: field === "start" ? value : "09:00",
          end: field === "end" ? value : "17:00",
        };
      return [...rest, ...periods].sort(
        (a, b) => a.day - b.day || a.start.localeCompare(b.start),
      );
    });
  }

  function addWeeklyPeriod(day: number) {
    setWeekly((current) =>
      current.filter((period) => period.day !== day).length >= 4
        ? current
        : [...current, { day, start: "09:00", end: "17:00" }].sort(
            (a, b) => a.day - b.day || a.start.localeCompare(b.start),
          ),
    );
  }

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

  if (!ready)
    return (
      <main
        className="mx-auto grid max-w-5xl gap-5 px-4 py-8 md:px-6"
        aria-busy={loading}
      >
        <div className="h-8 w-52 animate-pulse rounded bg-muted" />
        <div
          role={error ? "alert" : "status"}
          className={error ? "text-sm text-destructive" : "space-y-3"}
        >
          {error || t("Loading booking settings…")}
        </div>
        {error && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("Retry")}
          </Button>
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
        {publicReady && bootstrap.publicUrl && (
          <a
            className="text-sm font-medium underline underline-offset-4"
            href={bootstrap.publicUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t("Open public booking page")}
          </a>
        )}
      </header>

      <nav
        aria-label={t("Booking settings")}
        className="flex flex-wrap gap-2 border-b pb-2"
      >
        {(["settings", "availability", "reservations"] as const).map(
          (value) => (
            <Button
              key={value}
              type="button"
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
                    : "Reservations",
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
        <form className="grid gap-8" onSubmit={saveSettings}>
          <section
            className="grid gap-4"
            aria-labelledby="booking-settings-heading"
          >
            <h2 id="booking-settings-heading" className="text-lg font-semibold">
              {t("Booking settings")}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                {t("Public title")}
                <Input
                  required
                  value={settings.title}
                  onChange={(event) =>
                    updateSetting("title", event.target.value)
                  }
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                {t("IANA time zone")}
                <Input
                  list="booking-time-zones"
                  value={settings.timeZone}
                  onChange={(event) =>
                    updateSetting("timeZone", event.target.value)
                  }
                />
                <datalist id="booking-time-zones">
                  {[...new Set([...timeZones, settings.timeZone])].map(
                    (zone) => (
                      <option key={zone} value={zone} />
                    ),
                  )}
                </datalist>
              </label>
              <label className="grid gap-1.5 text-sm sm:col-span-2">
                {t("Description")}
                <Textarea
                  value={settings.description}
                  rows={3}
                  onChange={(event) =>
                    updateSetting("description", event.target.value)
                  }
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={settings.enabled}
                  onCheckedChange={(checked) =>
                    updateSetting("enabled", checked)
                  }
                />
                {t("Enabled")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={settings.published}
                  onCheckedChange={(checked) =>
                    updateSetting("published", checked)
                  }
                />
                {t("Published")}
              </label>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                "Enable a service and an assigned professional before publishing.",
              )}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["leadMinutes", "Lead time (minutes)"],
                  ["horizonDays", "Booking horizon (days)"],
                  ["cancellationMinutes", "Cancellation cutoff (minutes)"],
                  ["reminderMinutes", "Reminder (minutes before)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="grid gap-1.5 text-sm">
                  {t(label)}
                  <Input
                    type="number"
                    min={0}
                    max={key === "horizonDays" ? 180 : 43200}
                    step={1}
                    value={settings[key]}
                    onChange={(event) =>
                      updateSetting(key, Number(event.target.value))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <strong>{t("Public booking page")}</strong>
              {publicReady && bootstrap.publicUrl ? (
                <a
                  className="break-all underline underline-offset-4"
                  href={bootstrap.publicUrl}
                >
                  {bootstrap.publicUrl}
                </a>
              ) : (
                <span className="text-muted-foreground">
                  {t(
                    "Save enabled and published settings to open the public page.",
                  )}
                </span>
              )}
            </div>
          </section>

          <section className="grid gap-4" aria-labelledby="services-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="services-heading" className="text-lg font-semibold">
                {t("Services")}
              </h2>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  updateSetting("services", [
                    ...settings.services,
                    {
                      id: newId(),
                      name: "",
                      description: "",
                      durationMinutes: 30,
                      bufferMinutes: 0,
                      enabled: true,
                      professionalIds: [],
                    },
                  ])
                }
              >
                {t("Add service")}
              </Button>
            </div>
            {settings.services.map((service, index) => (
              <fieldset
                key={service.id}
                className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4"
              >
                <legend className="px-1 text-sm font-medium">
                  {service.name || t("Service name")}
                </legend>
                <label className="grid gap-1.5 text-sm">
                  {t("Service name")}
                  <Input
                    required
                    value={service.name}
                    onChange={(event) =>
                      updateService(index, { name: event.target.value })
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  {t("Duration (minutes)")}
                  <Input
                    type="number"
                    min={5}
                    max={480}
                    step={5}
                    value={service.durationMinutes}
                    onChange={(event) =>
                      updateService(index, {
                        durationMinutes: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  {t("Buffer (minutes)")}
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    step={5}
                    value={service.bufferMinutes}
                    onChange={(event) =>
                      updateService(index, {
                        bufferMinutes: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  {t("Enabled")}
                  <Switch
                    checked={service.enabled}
                    onCheckedChange={(checked) =>
                      updateService(index, { enabled: checked })
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-sm sm:col-span-2">
                  {t("Service description")}
                  <Textarea
                    value={service.description}
                    onChange={(event) =>
                      updateService(index, { description: event.target.value })
                    }
                  />
                </label>
                <fieldset className="grid gap-2 sm:col-span-2">
                  <legend className="text-sm">{t("Professionals")}</legend>
                  {settings.professionals.map((professional) => (
                    <label
                      key={professional.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={service.professionalIds.includes(
                          professional.id,
                        )}
                        onChange={(event) =>
                          updateService(index, {
                            professionalIds: event.target.checked
                              ? [...service.professionalIds, professional.id]
                              : service.professionalIds.filter(
                                  (id) => id !== professional.id,
                                ),
                          })
                        }
                      />
                      {bootstrap.candidates.find(
                        (candidate) =>
                          candidate.principalId === professional.principalId,
                      )?.displayName ?? professional.principalId}
                    </label>
                  ))}
                </fieldset>
              </fieldset>
            ))}
          </section>

          <section
            className="grid gap-4"
            aria-labelledby="professionals-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="professionals-heading" className="text-lg font-semibold">
                {t("Professionals")}
              </h2>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  updateSetting("professionals", [
                    ...settings.professionals,
                    {
                      id: newId(),
                      principalId: "",
                      enabled: true,
                      weekly: [],
                      exceptions: [],
                    },
                  ])
                }
              >
                {t("Add professional")}
              </Button>
            </div>
            {settings.professionals.map((professional, index) => (
              <div
                key={professional.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <label className="grid min-w-64 flex-1 gap-1.5 text-sm">
                  {t("Professional")}
                  <select
                    required
                    className="h-9 rounded-md border bg-background px-3"
                    value={professional.principalId}
                    onChange={(event) =>
                      updateProfessional(index, {
                        principalId: event.target.value,
                      })
                    }
                  >
                    <option value="">{t("Select a Savia member")}</option>
                    {bootstrap.candidates.map((candidate) => (
                      <option
                        key={candidate.principalId}
                        value={candidate.principalId}
                      >
                        {candidate.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={professional.enabled}
                    onCheckedChange={(checked) =>
                      updateProfessional(index, { enabled: checked })
                    }
                  />
                  {t("Enabled")}
                </label>
              </div>
            ))}
          </section>
          <Button type="submit" disabled={saving}>
            {saving ? t("Loading booking settings…") : t("Save settings")}
          </Button>
        </form>
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
                className="h-9 rounded-md border bg-background px-3"
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
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[38rem] text-sm">
                  <thead className="bg-muted/60 text-left">
                    <tr>
                      <th className="p-3">{t("Day")}</th>
                      <th className="p-3">{t("Start")}</th>
                      <th className="p-3">{t("End")}</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {weekdays.map((day, dayIndex) => {
                      const dayName = t(weekdayKeys[dayIndex]);
                      const periods = weekly.filter((item) => item.day === day);
                      const shown = periods.length
                        ? periods
                        : [{ day, start: "", end: "" }];
                      return shown.map((period, index) => (
                        <tr key={`${day}-${index}`} className="border-t">
                          <th scope="row" className="p-3 font-medium">
                            {index === 0 ? dayName : ""}
                            {index === 0 && (
                              <Button
                                className="ml-2"
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={periods.length >= 4}
                                onClick={() => addWeeklyPeriod(day)}
                              >
                                {t("Add period")}
                              </Button>
                            )}
                          </th>
                          <td className="p-2">
                            <Input
                              aria-label={`${day === 1 ? t("Monday start") : `${dayName} ${t("Start")}`}${index ? ` ${index + 1}` : ""}`}
                              type="time"
                              step={300}
                              value={period.start}
                              onChange={(event) =>
                                editPeriod(
                                  day,
                                  index,
                                  "start",
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              aria-label={`${day === 1 ? t("Monday end") : `${dayName} ${t("End")}`}${index ? ` ${index + 1}` : ""}`}
                              type="time"
                              step={300}
                              value={period.end}
                              onChange={(event) =>
                                editPeriod(
                                  day,
                                  index,
                                  "end",
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                          <td className="p-2">
                            {periods.length > 1 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                aria-label={`${dayName} ${t("Remove period")} ${index + 1}`}
                                onClick={() =>
                                  setWeekly((items) =>
                                    items.filter(
                                      (item) =>
                                        !(
                                          item.day === day &&
                                          item.start === period.start &&
                                          item.end === period.end
                                        ),
                                    ),
                                  )
                                }
                              >
                                {t("Remove period")}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
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
                  <Button
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
                  </Button>
                </div>
                {exceptions.map((exception) => (
                  <div
                    key={exception.date}
                    className="grid gap-3 rounded-lg border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{exception.date}</strong>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={exception.periods.length >= 4}
                          onClick={() => addExceptionPeriod(exception.date)}
                        >
                          {t("Add period")}
                        </Button>
                        <Button
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
                        </Button>
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
                          <Button
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
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </fieldset>
              <Button type="submit" disabled={saving}>
                {saving
                  ? t("Loading booking settings…")
                  : t("Save availability")}
              </Button>
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
                >
                  {t("Choose calendar")}: Google
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void changeCalendar("outlook")}
                >
                  {t("Choose calendar")}: Outlook
                </Button>
                {bootstrap.calendar.provider && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void changeCalendar(null)}
                  >
                    {t("Calendar not connected")}
                  </Button>
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
        </section>
      )}

      {tab === "reservations" && (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("Reservations")}</h2>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReservationsAttempt((value) => value + 1)}
            >
              {t("Retry")}
            </Button>
          </div>
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
                        {reservation.status === "confirmed" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={cancellingId === reservation.id}
                            onClick={() => void cancelReservation(reservation)}
                          >
                            {cancellingId === reservation.id
                              ? t("Loading booking settings…")
                              : t("Cancel reservation")}
                          </Button>
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
