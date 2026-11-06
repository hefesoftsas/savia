import { Button } from "@/components/ui/button";
import { useAppLocale, useMessages, intlLocale } from "@/i18n/core";
import { DayPicker } from "react-day-picker";
import { enUS, es, ptBR } from "react-day-picker/locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { bookingMessages } from "./booking-messages";
import { publicBookingWizardMessages } from "./public-booking-wizard-messages";
import type { BookingSelection, PublicBookingSlot } from "./booking-types";

type AvailabilityDay = { date: string; slots: PublicBookingSlot[] };
type AvailabilityResult = {
  displayTimeZone: string;
  businessTimeZone: string;
  days: AvailabilityDay[];
};
type Props = {
  token: string;
  mode?: "booking" | "management";
  catalog: {
    id: string;
    timeZone: string;
    horizonDays: number;
    leadMinutes: number;
  };
  serviceId: string;
  professionalId: string;
  displayTimeZone: string;
  onTimeZoneChange(timeZone: string): void;
  value: BookingSelection | undefined;
  onChange(selection: BookingSelection | undefined): void;
  onLoadingChange?(loading: boolean): void;
  refreshKey?: number;
  hideHeading?: boolean;
  excludedStartsAt?: string[];
};

const dayString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function fromDayString(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function todayInZone(zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayForInstant(instant: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function humanTimeZone(zone: string, locale: string) {
  const names: Record<string, string> = {
    "America/Bogota": "Bogotá",
    "America/Mexico_City": "Mexico City",
    "America/New_York": "New York",
    "America/Los_Angeles": "Los Angeles",
    "Europe/London": "London",
    "Europe/Madrid": "Madrid",
    "Europe/Lisbon": "Lisbon",
    "Asia/Tokyo": "Tokyo",
  };
  return names[zone] ?? zone.split("/").at(-1)?.replaceAll("_", " ") ?? zone;
}

function formatSlot(
  instant: string,
  zone: string,
  locale: string,
  includeZone = false,
) {
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(instant));
  if (!includeZone) return time;
  const shortZone = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    timeZoneName: "short",
  })
    .formatToParts(new Date(instant))
    .find((part) => part.type === "timeZoneName")?.value;
  return `${time} ${shortZone ?? ""}`.trim();
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function addDays(value: string, amount: number) {
  const date = fromDayString(value);
  date.setDate(date.getDate() + amount);
  return dayString(date);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
}

function sameMonth(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

async function fetchAvailability(path: string, signal: AbortSignal) {
  const response = await fetch(path, {
    signal,
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  const body = (await response.json()) as { data?: AvailabilityResult };
  if (!response.ok || !body.data) throw new Error("Availability unavailable");
  return body.data;
}

export function PublicBookingAvailability({
  token,
  mode = "booking",
  catalog,
  serviceId,
  professionalId,
  displayTimeZone,
  onTimeZoneChange,
  value,
  onChange,
  onLoadingChange,
  refreshKey = 0,
  hideHeading = false,
  excludedStartsAt = [],
}: Props) {
  const t = useMessages(bookingMessages);
  const wt = useMessages(publicBookingWizardMessages);
  const locale = useAppLocale();
  const today = todayInZone(displayTimeZone);
  const horizonEnd = addDays(today, Math.max(0, catalog.horizonDays));
  const initialDay = value
    ? dayForInstant(value.slot.startsAt, displayTimeZone)
    : today;
  const [visibleMonth, setVisibleMonth] = useState(() =>
    monthStart(fromDayString(initialDay)),
  );
  const [selectedDay, setSelectedDay] = useState(
    value ? dayForInstant(value.slot.startsAt, displayTimeZone) : "",
  );
  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);

  const range = useMemo(() => {
    const start = dayString(visibleMonth);
    const lastOfMonth = dayString(
      new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0, 12),
    );
    return {
      from: start < today ? today : start,
      to: lastOfMonth > horizonEnd ? horizonEnd : lastOfMonth,
    };
  }, [visibleMonth, today, horizonEnd]);

  useEffect(() => {
    if (!serviceId || !professionalId || range.from > range.to) {
      setDays([]);
      setLoading(false);
      onLoadingChange?.(false);
      return;
    }
    const controller = new AbortController();
    const id = ++requestId.current;
    setLoading(true);
    onLoadingChange?.(true);
    setRequestError(false);
    setDays([]);
    const query = new URLSearchParams({
      serviceId,
      professionalId,
      from: range.from,
      to: range.to,
      displayTimeZone,
    });
    const endpoint =
      mode === "management"
        ? `/api/public/bookings/manage/${encodeURIComponent(token)}/availability`
        : `/api/public/bookings/${encodeURIComponent(token)}/availability`;
    void fetchAvailability(`${endpoint}?${query}`, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || requestId.current !== id) return;
        setDays(result.days);
        setRequestError(false);
        if (!selectedDay) {
          const firstAvailable = result.days.find(
            (day) => day.slots.length,
          )?.date;
          if (firstAvailable) setSelectedDay(firstAvailable);
        }
        if (value) {
          const matching = result.days
            .flatMap((day) => day.slots)
            .find((slot) => slot.startsAt === value.slot.startsAt);
          if (matching) {
            const nextDay = dayForInstant(matching.startsAt, displayTimeZone);
            setSelectedDay(nextDay);
            onChange({ ...value, slot: matching, displayTimeZone });
          } else {
            onChange(undefined);
          }
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && requestId.current === id) {
          setRequestError(true);
          setDays([]);
          if (value) onChange(undefined);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && requestId.current === id) {
          setLoading(false);
          onLoadingChange?.(false);
        }
      });
    return () => controller.abort();
  }, [
    token,
    mode,
    serviceId,
    professionalId,
    displayTimeZone,
    range,
    attempt,
    refreshKey,
    onLoadingChange,
  ]);

  useEffect(() => {
    if (value) {
      const date = dayForInstant(value.slot.startsAt, displayTimeZone);
      setSelectedDay(date);
      setVisibleMonth(monthStart(fromDayString(date)));
    }
  }, [displayTimeZone]);

  const availableDays = useMemo(
    () =>
      new Set(days.filter((day) => day.slots.length).map((day) => day.date)),
    [days],
  );
  const selectedSlots =
    days.find((day) => day.date === selectedDay)?.slots ?? [];
  const nextMonth = addMonths(visibleMonth, 1);
  const nextAllowed = dayString(nextMonth) <= horizonEnd;
  const repeatedLabels = useMemo(() => {
    const labels = selectedSlots.map((slot) =>
      formatSlot(slot.startsAt, displayTimeZone, intlLocale(locale)),
    );
    return new Set(
      labels.filter((label, index) => labels.indexOf(label) !== index),
    );
  }, [selectedSlots, displayTimeZone, locale]);

  function pickDay(date: Date | undefined) {
    if (!date) return;
    const nextDay = dayString(date);
    if (!availableDays.has(nextDay)) return;
    setSelectedDay(nextDay);
    onChange(undefined);
  }

  function changeZone(zone: string) {
    if (!zone || zone === displayTimeZone) return;
    onTimeZoneChange(zone);
    if (value) {
      const date = dayForInstant(value.slot.startsAt, zone);
      setSelectedDay(date);
      setVisibleMonth(monthStart(fromDayString(date)));
    } else {
      setSelectedDay("");
      onChange(undefined);
    }
  }

  const dayPickerLocale = locale === "es" ? es : locale === "pt" ? ptBR : enUS;

  return (
    <section
      aria-labelledby={
        hideHeading ? "booking-step-heading" : "availability-heading"
      }
      className="grid min-w-0 gap-4"
    >
      <div className="grid gap-1">
        {!hideHeading && (
          <h2 id="availability-heading" className="text-lg font-semibold">
            {wt("Choose a day and time")}
          </h2>
        )}
        <label className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t("Booking time zone")}</span>
          <select
            aria-label={t("Time zone")}
            className="h-10 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={displayTimeZone}
            onChange={(event) => changeZone(event.target.value)}
          >
            {[
              displayTimeZone,
              catalog.timeZone,
              "America/New_York",
              "America/Los_Angeles",
              "Europe/London",
              "Europe/Lisbon",
              "Asia/Tokyo",
            ]
              .filter((zone, index, all) => all.indexOf(zone) === index)
              .map((zone) => (
                <option key={zone} value={zone}>
                  {humanTimeZone(zone, intlLocale(locale))} · {zone}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="grid min-w-0 gap-4 rounded-lg border bg-card p-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] sm:gap-5 sm:p-4">
        <div className="min-w-0">
          <DayPicker
            mode="single"
            month={visibleMonth}
            onMonthChange={(month) => {
              setSelectedDay("");
              onChange(undefined);
              setVisibleMonth(monthStart(month));
            }}
            selected={selectedDay ? fromDayString(selectedDay) : undefined}
            onSelect={pickDay}
            lang={intlLocale(locale)}
            locale={dayPickerLocale}
            showOutsideDays={false}
            disabled={(date) => {
              const day = dayString(date);
              return day < today || day > horizonEnd || !availableDays.has(day);
            }}
            startMonth={monthStart(fromDayString(today))}
            endMonth={monthStart(fromDayString(horizonEnd))}
            className="mx-auto w-full max-w-[21rem]"
            classNames={{
              root: "relative w-full",
              months: "w-full",
              month: "relative w-full space-y-3",
              month_caption:
                "relative z-0 flex h-10 items-center justify-center",
              caption_label: "text-sm font-semibold",
              nav: "absolute inset-x-0 top-0 z-10 flex h-10 items-center justify-between pointer-events-none",
              button_previous:
                "pointer-events-auto inline-flex size-9 items-center justify-center rounded-md border text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
              button_next:
                "pointer-events-auto inline-flex size-9 items-center justify-center rounded-md border text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
              chevron: "size-5 fill-current text-foreground",
              month_grid: "w-full border-collapse",
              weekdays: "grid grid-cols-7",
              weekday:
                "flex h-9 items-center justify-center text-[0.68rem] font-medium text-muted-foreground sm:text-xs",
              week: "mt-1 grid grid-cols-7",
              day: "flex items-center justify-center p-0.5 text-sm",
              day_button:
                "inline-flex size-9 items-center justify-center rounded-md text-sm tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 aria-selected:bg-primary aria-selected:text-primary-foreground sm:size-10",
              selected:
                "[&>button]:bg-primary [&>button]:text-primary-foreground",
              today:
                "[&>button]:font-bold [&>button]:underline [&>button]:underline-offset-2",
              disabled: "opacity-40",
              outside: "invisible",
            }}
            labels={{
              labelPrevious: () => t("Previous month"),
              labelNext: () => t("Next month"),
            }}
          />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {t("Days with availability are enabled.")}
          </p>
        </div>
        <div className="min-w-0 border-t pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-1">
          <h3 className="mb-3 text-sm font-semibold">
            {selectedDay
              ? new Intl.DateTimeFormat(intlLocale(locale), {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(fromDayString(selectedDay))
              : t("Choose an available day")}
          </h3>
          {loading && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("Loading available times…")}
            </p>
          )}
          {!loading && requestError && (
            <div className="grid gap-3 text-sm">
              <p role="alert" className="text-destructive">
                {t(
                  "Available times could not be loaded. Choose another date and retry.",
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-fit"
                onClick={() => setAttempt((current) => current + 1)}
              >
                {t("Retry")}
              </Button>
            </div>
          )}
          {!loading && !requestError && !availableDays.size && (
            <div className="grid gap-3 text-sm">
              <p>{t("No availability in this month.")}</p>
              {nextAllowed && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-fit"
                  onClick={() => setVisibleMonth(nextMonth)}
                >
                  {t("Next month")}
                </Button>
              )}
              {!nextAllowed && (
                <p className="text-muted-foreground">
                  {t("No more dates are available in this booking window.")}
                </p>
              )}
            </div>
          )}
          {!loading &&
            !requestError &&
            availableDays.size > 0 &&
            !selectedDay && (
              <p className="text-sm text-muted-foreground">
                {t("Choose an available day")}
              </p>
            )}
          {!loading && selectedDay && selectedSlots.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("No available times")}
            </p>
          )}
          {!!selectedSlots.length && (
            <div
              role="group"
              aria-label={t("Available times for %{date}", {
                date: new Intl.DateTimeFormat(intlLocale(locale), {
                  dateStyle: "long",
                  timeZone: "UTC",
                }).format(fromDayString(selectedDay)),
              })}
              className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2"
            >
              {selectedSlots.map((slot) => {
                const chosen = value?.slot.startsAt === slot.startsAt;
                const excluded = excludedStartsAt.includes(slot.startsAt);
                return (
                  <Button
                    key={slot.startsAt}
                    type="button"
                    variant={chosen ? "default" : "outline"}
                    aria-pressed={chosen}
                    disabled={excluded}
                    className="min-h-11 px-2 tabular-nums"
                    onClick={() =>
                      onChange({
                        professionalId,
                        serviceId,
                        slot,
                        displayTimeZone,
                      })
                    }
                  >
                    {formatSlot(
                      slot.startsAt,
                      displayTimeZone,
                      intlLocale(locale),
                      repeatedLabels.has(
                        formatSlot(
                          slot.startsAt,
                          displayTimeZone,
                          intlLocale(locale),
                        ),
                      ),
                    )}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
