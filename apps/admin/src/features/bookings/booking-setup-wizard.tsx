import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMessages } from "@/i18n/core";
import { bookingMessages } from "./booking-messages";
import { bookingSetupMessages } from "./booking-setup-messages";
import type {
  Candidate,
  Period,
  Professional,
  Service,
  Settings,
} from "./booking-types";

const steps = [
  "Details",
  "Team",
  "Services",
  "Hours",
  "Review and publish",
] as const;
const descriptions = [
  "Introduce your booking page.",
  "Choose who takes appointments.",
  "Define what your customers can book.",
  "Set the team's weekly schedule.",
  "Check your setup before sharing it.",
] as const;
const days = [1, 2, 3, 4, 5, 6, 0];
const dayKeys = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const inputClass = "h-11 text-base sm:text-sm";
const selectClass =
  "h-11 min-w-0 w-full rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm";
function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 3) | 8).toString(16);
  });
}
function validWeekly(weekly: Period[]) {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return days.every((day) => {
    const periods = weekly
      .filter((p) => p.day === day)
      .sort((a, b) => a.start.localeCompare(b.start));
    return (
      periods.length <= 4 &&
      periods.every(
        (p, i) =>
          time.test(p.start) &&
          time.test(p.end) &&
          Number(p.start.slice(3)) % 5 === 0 &&
          Number(p.end.slice(3)) % 5 === 0 &&
          p.end > p.start &&
          (!i || periods[i - 1].end <= p.start),
      )
    );
  });
}

export function WeeklyHoursEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: Period[];
  onChange: (value: Period[]) => void;
  disabled?: boolean;
}) {
  const t = useMessages(bookingMessages);
  const w = useMessages(bookingSetupMessages);
  return (
    <div className="divide-y">
      {days.map((day, dayIndex) => {
        const periods = value.filter((p) => p.day === day);
        const replace = (next: Period[]) =>
          onChange([...value.filter((p) => p.day !== day), ...next]);
        return (
          <div key={day} className="grid gap-3 py-4 sm:grid-cols-[8rem_1fr]">
            <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-start sm:justify-start">
              <span className="text-sm font-medium">
                {t(dayKeys[dayIndex])}
              </span>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 px-2 text-foreground"
                disabled={disabled || periods.length >= 4}
                onClick={() =>
                  replace([
                    ...periods,
                    {
                      day,
                      start: periods.at(-1)?.end ?? "09:00",
                      end: "17:00",
                    },
                  ])
                }
              >
                <Plus className="size-4" />
                {t("Add period")}
              </Button>
            </div>
            <div className="grid gap-2">
              {!periods.length && (
                <p className="self-center text-sm text-muted-foreground">
                  {w("Closed")}
                </p>
              )}
              {periods.map((period, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-end gap-2"
                >
                  {(["start", "end"] as const).map((field) => (
                    <label
                      key={field}
                      className="grid min-w-0 gap-1 text-xs text-muted-foreground"
                    >
                      {t(field === "start" ? "Start" : "End")}
                      <Input
                        disabled={disabled}
                        className={`${inputClass} min-w-0 w-full text-foreground`}
                        aria-label={`${day === 1 ? t(field === "start" ? "Monday start" : "Monday end") : `${t(dayKeys[dayIndex])} ${t(field === "start" ? "Start" : "End")}`}${index ? ` ${index + 1}` : ""}`}
                        type="time"
                        step={300}
                        value={period[field]}
                        onChange={(event) =>
                          replace(
                            periods.map((p, i) =>
                              i === index
                                ? { ...p, [field]: event.target.value }
                                : p,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    className="size-11 text-muted-foreground hover:text-destructive"
                    disabled={disabled}
                    aria-label={`${t(dayKeys[dayIndex])} ${t("Remove period")} ${index + 1}`}
                    onClick={() =>
                      replace(periods.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BookingSetupWizard({
  settings,
  candidates,
  onChange,
  onSave,
  onReset,
  saving,
  publicUrl,
}: {
  settings: Settings;
  candidates: Candidate[];
  onChange: (settings: Settings) => void;
  onSave: (settings: Settings) => Promise<void>;
  onReset: () => void;
  saving: boolean;
  publicUrl: string | null;
}) {
  const t = useMessages(bookingMessages);
  const w = useMessages(bookingSetupMessages);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [hoursId, setHoursId] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) heading.current?.focus();
    initialized.current = true;
  }, [step]);
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });
  const professional = (id: string, patch: Partial<Professional>) =>
    change(
      "professionals",
      settings.professionals.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  const service = (id: string, patch: Partial<Service>) =>
    change(
      "services",
      settings.services.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  const name = (p: Professional) =>
    candidates.find((c) => c.principalId === p.principalId)?.displayName ||
    p.principalId ||
    t("Select a Savia member");
  const hours =
    settings.professionals.find((p) => p.id === hoursId) ??
    settings.professionals[0];
  function validation(at: number): string {
    if (at === 0) {
      if (!settings.title.trim()) return w("Enter a public title.");
      try {
        new Intl.DateTimeFormat("en", { timeZone: settings.timeZone }).format();
      } catch {
        return t("Use an IANA time zone.");
      }
      if (
        ![
          settings.leadMinutes,
          settings.cancellationMinutes,
          settings.reminderMinutes,
        ].every((n) => Number.isInteger(n) && n >= 0 && n <= 43200) ||
        !Number.isInteger(settings.horizonDays) ||
        settings.horizonDays < 1 ||
        settings.horizonDays > 180
      )
        return w("Enter valid booking rules.");
    }
    if (at === 1) {
      if (
        settings.professionals.some(
          (p) =>
            !p.principalId ||
            !candidates.some((c) => c.principalId === p.principalId),
        )
      )
        return w("Select a member for each professional.");
      if (
        new Set(settings.professionals.map((p) => p.principalId)).size !==
        settings.professionals.length
      )
        return t("Services and professionals must be unique.");
    }
    if (
      at === 2 &&
      settings.services.some(
        (s) =>
          !s.name.trim() ||
          !Number.isInteger(s.durationMinutes) ||
          s.durationMinutes < 5 ||
          s.durationMinutes > 480 ||
          s.durationMinutes % 5 !== 0 ||
          !Number.isInteger(s.bufferMinutes) ||
          s.bufferMinutes < 0 ||
          s.bufferMinutes > 120 ||
          s.bufferMinutes % 5 !== 0,
      )
    )
      return w("Name each service and use valid durations.");
    if (at === 3 && settings.professionals.some((p) => !validWeekly(p.weekly)))
      return w(
        "Check weekly hours. Use five-minute increments and non-overlapping periods.",
      );
    return "";
  }
  function go(next: number) {
    setError("");
    setStep(next);
  }
  function advance() {
    const issue = validation(step);
    if (issue) setError(issue);
    else go(Math.min(4, step + 1));
  }
  async function save(mode: "draft" | "settings" | "publish") {
    for (let at = 0; at < 4; at++) {
      const issue = validation(at);
      if (issue) {
        setStep(at);
        setError(issue);
        return;
      }
    }
    const next = {
      ...settings,
      published:
        mode === "draft"
          ? false
          : mode === "publish"
            ? true
            : settings.published,
      enabled: mode === "publish" ? true : settings.enabled,
    };
    if (
      next.published &&
      !next.services.some(
        (s) =>
          s.enabled &&
          s.professionalIds.some((id) =>
            next.professionals.some((p) => p.id === id && p.enabled),
          ),
      )
    ) {
      setError(
        t("Enable a service and an assigned professional before publishing."),
      );
      setStep(4);
      return;
    }
    setError("");
    await onSave(next);
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <nav aria-label={t("Booking settings")} className="min-w-0">
        <p className="mb-3 text-sm text-muted-foreground lg:mb-4">
          {w("Step %{current} of %{total}", { current: step + 1, total: 5 })}
        </p>
        <ol className="grid grid-cols-5 gap-1 lg:grid-cols-1 lg:gap-2">
          {steps.map((label, index) => (
            <li key={label} className="lg:w-full">
              <Button
                type="button"
                disabled={saving}
                variant={step === index ? "secondary" : "ghost"}
                aria-current={step === index ? "step" : undefined}
                className="min-h-11 max-w-full justify-center gap-2 px-2 lg:w-full lg:justify-start lg:px-3"
                onClick={() => go(index)}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs ${step === index ? "bg-primary text-primary-foreground" : "border text-muted-foreground"}`}
                >
                  {index + 1}
                </span>
                <span className="sr-only lg:not-sr-only">
                  {label === "Services" ? t("Services") : w(label)}
                </span>
              </Button>
            </li>
          ))}
        </ol>
      </nav>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save("settings");
        }}
        className="min-w-0"
      >
        <fieldset disabled={saving} className="min-w-0 space-y-6">
          <div>
            <h2
              ref={heading}
              tabIndex={-1}
              className="text-xl font-semibold tracking-tight outline-none sm:text-2xl"
            >
              {steps[step] === "Services" ? t("Services") : w(steps[step])}
            </h2>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {w(descriptions[step])}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {step === 0 && (
            <div className="grid gap-5">
              <label className="grid gap-2 text-sm font-medium">
                {t("Public title")}
                <Input
                  className={inputClass}
                  value={settings.title}
                  onChange={(e) => change("title", e.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                {t("Description")}
                <Textarea
                  rows={3}
                  className="text-base sm:text-sm"
                  value={settings.description}
                  onChange={(e) => change("description", e.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                {t("IANA time zone")}
                <Input
                  className={inputClass}
                  list="booking-time-zones"
                  value={settings.timeZone}
                  onChange={(e) => change("timeZone", e.target.value)}
                />
                <datalist id="booking-time-zones">
                  {[
                    "America/Bogota",
                    "America/Lima",
                    "America/Mexico_City",
                    "America/New_York",
                    "Europe/London",
                    "Europe/Lisbon",
                    "UTC",
                  ].map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </label>
              <div className="grid gap-2 text-sm font-medium">
                <label htmlFor="booking-conference-provider">
                  {t("Video meeting provider")}
                </label>
                <select
                  id="booking-conference-provider"
                  aria-describedby="booking-conference-help"
                  className={`${inputClass} w-full rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                  value={settings.conferenceProvider ?? "automatic"}
                  onChange={(event) =>
                    change(
                      "conferenceProvider",
                      event.target.value as "automatic" | "jitsi",
                    )
                  }
                >
                  <option value="automatic">
                    {t("Automatic (Google Meet or Teams)")}
                  </option>
                  <option value="jitsi">Jitsi</option>
                </select>
                <span
                  id="booking-conference-help"
                  className="text-xs font-normal text-muted-foreground"
                >
                  {t(
                    "New appointments include the meeting link in confirmations and reminders.",
                  )}
                </span>
              </div>
              <details className="border-t pt-4">
                <summary className="min-h-11 cursor-pointer text-sm font-medium">
                  {w("Booking rules")}
                </summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["leadMinutes", "Lead time (minutes)"],
                      ["horizonDays", "Booking horizon (days)"],
                      ["cancellationMinutes", "Cancellation cutoff (minutes)"],
                      ["reminderMinutes", "Reminder (minutes before)"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="grid gap-2 text-sm">
                      {t(label)}
                      <Input
                        className={inputClass}
                        type="number"
                        min={key === "horizonDays" ? 1 : 0}
                        max={key === "horizonDays" ? 180 : 43200}
                        value={settings[key]}
                        onChange={(e) => change(key, Number(e.target.value))}
                      />
                    </label>
                  ))}
                </div>
              </details>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              {!settings.professionals.length && (
                <p className="text-sm text-muted-foreground">
                  {w("No professionals yet.")}
                </p>
              )}
              {!candidates.length && (
                <p className="text-sm text-muted-foreground">
                  {w(
                    "No eligible members. Add an active user to this organization first.",
                  )}
                </p>
              )}
              {settings.professionals.map((p) => (
                <div
                  key={p.id}
                  className="grid gap-3 border-b pb-5 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <label className="grid min-w-0 gap-2 text-sm font-medium">
                    {t("Professional")}
                    <select
                      className={selectClass}
                      value={p.principalId}
                      onChange={(e) =>
                        professional(p.id, { principalId: e.target.value })
                      }
                    >
                      <option value="">{t("Select a Savia member")}</option>
                      {candidates.map((c) => (
                        <option
                          key={c.principalId}
                          value={c.principalId}
                          disabled={settings.professionals.some(
                            (other) =>
                              other.id !== p.id &&
                              other.principalId === c.principalId,
                          )}
                        >
                          {c.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-center justify-between gap-3 sm:self-end">
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={(enabled) =>
                          professional(p.id, { enabled })
                        }
                      />
                      {t("Enabled")}
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 text-destructive"
                      aria-label={`${w("Remove professional")} ${name(p)}`}
                      onClick={() =>
                        onChange({
                          ...settings,
                          professionals: settings.professionals.filter(
                            (other) => other.id !== p.id,
                          ),
                          services: settings.services.map((s) => ({
                            ...s,
                            professionalIds: s.professionalIds.filter(
                              (id) => id !== p.id,
                            ),
                          })),
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                      {w("Remove professional")}
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={settings.professionals.length >= candidates.length}
                onClick={() =>
                  change("professionals", [
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
                <Plus className="size-4" />
                {t("Add professional")}
              </Button>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-6">
              {!settings.services.length && (
                <p className="text-sm text-muted-foreground">
                  {w("No services yet.")}
                </p>
              )}
              {settings.services.map((s, index) => (
                <section
                  key={s.id}
                  aria-label={s.name || `${t("Service")} ${index + 1}`}
                  className="space-y-4 border-b pb-6"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="min-w-0 break-words font-medium">
                      {s.name || `${t("Service")} ${index + 1}`}
                    </h3>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 px-2 text-destructive"
                      aria-label={`${w("Remove service")} ${s.name || index + 1}`}
                      onClick={() =>
                        change(
                          "services",
                          settings.services.filter(
                            (other) => other.id !== s.id,
                          ),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                      {w("Remove service")}
                    </Button>
                  </div>
                  <label className="grid gap-2 text-sm">
                    {t("Service name")}
                    <Input
                      className={inputClass}
                      value={s.name}
                      onChange={(e) => service(s.id, { name: e.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        ["durationMinutes", "Duration (minutes)", 5, 480],
                        ["bufferMinutes", "Buffer (minutes)", 0, 120],
                      ] as const
                    ).map(([key, label, min, max]) => (
                      <label key={key} className="grid gap-2 text-sm">
                        {t(label)}
                        <Input
                          className={inputClass}
                          type="number"
                          min={min}
                          max={max}
                          step={5}
                          value={s[key]}
                          onChange={(e) =>
                            service(s.id, { [key]: Number(e.target.value) })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label className="grid gap-2 text-sm">
                    {t("Service description")}
                    <Textarea
                      rows={2}
                      className="text-base sm:text-sm"
                      value={s.description}
                      onChange={(e) =>
                        service(s.id, { description: e.target.value })
                      }
                    />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={(enabled) => service(s.id, { enabled })}
                    />
                    {t("Enabled")}
                  </label>
                  <div>
                    <p className="text-sm font-medium">{t("Professionals")}</p>
                    {!settings.professionals.length && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {w("Add your team before assigning services.")}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-5">
                      {settings.professionals.map((p) => (
                        <label
                          key={p.id}
                          className="flex min-h-11 items-center gap-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="size-5 accent-primary"
                            checked={s.professionalIds.includes(p.id)}
                            onChange={(e) =>
                              service(s.id, {
                                professionalIds: e.target.checked
                                  ? [...s.professionalIds, p.id]
                                  : s.professionalIds.filter(
                                      (id) => id !== p.id,
                                    ),
                              })
                            }
                          />
                          {name(p)}
                        </label>
                      ))}
                    </div>
                  </div>
                </section>
              ))}
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() =>
                  change("services", [
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
                <Plus className="size-4" />
                {t("Add service")}
              </Button>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-5">
              {!hours ? (
                <p className="text-sm text-muted-foreground">
                  {w("No professionals yet.")}
                </p>
              ) : (
                <>
                  <label className="grid gap-2 text-sm font-medium">
                    {t("Professional")}
                    <select
                      className={selectClass}
                      value={hours.id}
                      onChange={(e) => setHoursId(e.target.value)}
                    >
                      {settings.professionals.map((p) => (
                        <option key={p.id} value={p.id}>
                          {name(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-sm text-muted-foreground">
                    {settings.timeZone}
                  </p>
                  <WeeklyHoursEditor
                    value={hours.weekly}
                    onChange={(weekly) => professional(hours.id, { weekly })}
                  />
                  <p className="text-sm text-muted-foreground">
                    {w(
                      "Date exceptions can be managed in Availability after saving.",
                    )}
                  </p>
                </>
              )}
            </div>
          )}
          {step === 4 && (
            <div className="space-y-5">
              <dl className="divide-y">
                {steps.slice(0, 4).map((label, index) => (
                  <div
                    key={label}
                    className="flex items-start justify-between gap-4 py-4"
                  >
                    <div className="min-w-0">
                      <dt className="text-sm text-muted-foreground">
                        {label === "Services" ? t("Services") : w(label)}
                      </dt>
                      <dd className="mt-1 break-words text-sm font-medium">
                        {index === 0
                          ? `${settings.title} · ${settings.timeZone}`
                          : index === 1
                            ? settings.professionals.map(name).join(", ") ||
                              w("No professionals yet.")
                            : index === 2
                              ? settings.services
                                  .map(
                                    (s) =>
                                      `${s.name} (${s.durationMinutes} min)`,
                                  )
                                  .join(", ") || w("No services yet.")
                              : settings.professionals
                                  .map(
                                    (p) =>
                                      `${name(p)}: ${p.weekly.length ? [...new Set(p.weekly.map((period) => period.day))].map((day) => t(dayKeys[days.indexOf(day)])).join(", ") : w("No weekly hours")}`,
                                  )
                                  .join(" · ")}
                      </dd>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11"
                      aria-label={`${w("Edit")} ${label === "Services" ? t("Services") : w(label)}`}
                      onClick={() => go(index)}
                    >
                      {w("Edit")}
                    </Button>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-6">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <Switch
                    checked={settings.enabled}
                    onCheckedChange={(enabled) => change("enabled", enabled)}
                  />
                  {t("Enabled")}
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <Switch
                    checked={settings.published}
                    onCheckedChange={(published) =>
                      change("published", published)
                    }
                  />
                  {t("Published")}
                </label>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {w(
                  "Publishing makes your booking link available to customers.",
                )}
              </p>
              {publicUrl && (
                <a
                  className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline underline-offset-4"
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Public booking page")}
                </a>
              )}
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {w(
              "Changes take effect when saved. Existing reservations keep their history.",
            )}
          </p>
        </fieldset>
        <div className="mt-6 grid gap-3 border-t pt-5">
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={saving || step === 0}
              onClick={() => go(step - 1)}
            >
              <ArrowLeft className="size-4" />
              {w("Back")}
            </Button>
            {step < 4 ? (
              <Button
                type="button"
                className="min-h-11"
                disabled={saving}
                onClick={advance}
              >
                {w("Continue")}
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                className="min-h-11"
                disabled={saving}
                onClick={() => void save("publish")}
              >
                <Check className="size-4" />
                {w("Save and publish")}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="outline"
              className="min-h-11"
              disabled={saving}
            >
              {saving ? t("Loading booking settings…") : t("Save settings")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={saving}
              onClick={() => void save("draft")}
            >
              {w("Save draft")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 text-muted-foreground"
              disabled={saving}
              onClick={() => {
                onReset();
                setError("");
              }}
            >
              {w("Discard changes")}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
