import { Button } from "@/components/ui/button";
import { useMessages, useAppLocale } from "@/i18n/core";
import { useEffect, useState } from "react";
import { bookingMessages } from "./booking-messages";

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
type ManageBootstrap = {
  reservation: Reservation;
  publicUrl: string;
  timeZone: string;
  cancellationMinutes: number;
};
type Slot = { startsAt: string; endsAt: string };

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "omit",
    headers: { Accept: "application/json", ...init?.headers },
  });
  const value = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(value.error?.message ?? "Request failed");
  return value.data as T;
}

function dateForZone(iso: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function timeForZone(iso: string, zone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  }).format(new Date(iso));
}

export function PublicBookingManagePage({ token }: { token: string }) {
  const t = useMessages(bookingMessages);
  const locale = useAppLocale();
  const [bootstrap, setBootstrap] = useState<ManageBootstrap>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [startsAt, setStartsAt] = useState("");
  const [slotsLoading, setSlotsLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void publicRequest<ManageBootstrap>(
      `/api/public/bookings/manage/${encodeURIComponent(token)}`,
    )
      .then((data) => {
        if (active) {
          setBootstrap(data);
          setDate(dateForZone(data.reservation.startsAt, data.timeZone));
        }
      })
      .catch(() => {
        if (active)
          setError(
            t(
              "This booking link could not be loaded. Ask the booking owner for help.",
            ),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, t]);

  useEffect(() => {
    if (!rescheduling || !bootstrap || !date) return;
    let active = true;
    setSlotsLoading(true);
    setError("");
    void publicRequest<{ slots: Slot[]; timeZone: string }>(
      `/api/public/bookings/manage/${encodeURIComponent(token)}/slots?date=${encodeURIComponent(date)}`,
    )
      .then((data) => {
        if (active) setSlots(data.slots);
      })
      .catch(() => {
        if (active)
          setError(
            t(
              "Available times could not be loaded. Choose another date and retry.",
            ),
          );
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rescheduling, bootstrap, token, date, t]);

  async function cancel() {
    if (!bootstrap) return;
    setBusy(true);
    setError("");
    try {
      const reservation = await publicRequest<Reservation>(
        `/api/public/bookings/manage/${encodeURIComponent(token)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: bootstrap.reservation.version }),
        },
      );
      setBootstrap({ ...bootstrap, reservation });
    } catch {
      setError(
        t("This booking could not be cancelled. Refresh the page and retry."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!bootstrap || !startsAt) return;
    setBusy(true);
    setError("");
    try {
      const reservation = await publicRequest<Reservation>(
        `/api/public/bookings/manage/${encodeURIComponent(token)}/reschedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: bootstrap.reservation.version,
            startsAt,
          }),
        },
      );
      setBootstrap({ ...bootstrap, reservation });
      setRescheduling(false);
      setStartsAt("");
    } catch {
      setError(
        t(
          "This booking could not be rescheduled. Refresh the times and retry.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className="mx-auto max-w-2xl px-4 py-10" role="status">
        {t("Loading booking settings…")}
      </main>
    );
  if (!bootstrap)
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </main>
    );
  const reservation = bootstrap.reservation;
  const canChange =
    Date.parse(reservation.startsAt) - Date.now() >=
    bootstrap.cancellationMinutes * 60000;
  return (
    <main className="mx-auto grid max-w-2xl gap-5 px-4 py-8 md:py-12">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold">
          {t("Manage or cancel this appointment")}
        </h1>
        <p>
          {reservation.serviceName} · {reservation.professionalName}
        </p>
        <p>
          {timeForZone(reservation.startsAt, bootstrap.timeZone, locale)} ·{" "}
          {bootstrap.timeZone}
        </p>
        <p>
          {reservation.customerName} · {reservation.customerEmail}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("Cancellation cutoff (minutes)")}: {bootstrap.cancellationMinutes}
        </p>
      </header>
      <p role="status" className="text-sm">
        {t(reservation.status === "confirmed" ? "Confirmed" : "Cancelled")}
      </p>
      {reservation.status === "confirmed" && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || !canChange}
            onClick={() => {
              setRescheduling((current) => !current);
              setDate(dateForZone(reservation.startsAt, bootstrap.timeZone));
            }}
          >
            {rescheduling ? t("Cancel") : t("Reschedule")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || !canChange}
            onClick={() => void cancel()}
          >
            {t("Cancel reservation")}
          </Button>
        </div>
      )}
      {reservation.status === "confirmed" && !canChange && (
        <p className="text-sm text-muted-foreground">
          {t("The cancellation and rescheduling window has closed.")}
        </p>
      )}
      {rescheduling && reservation.status === "confirmed" && (
        <section className="grid gap-3 rounded-lg border p-4">
          <label className="grid gap-1.5 text-sm">
            {t("Date")}
            <input
              className="h-10 rounded-md border bg-background px-3"
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setStartsAt("");
              }}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            {t("Available time")}
            <select
              className="h-10 rounded-md border bg-background px-3"
              value={startsAt}
              disabled={slotsLoading || !slots.length}
              onChange={(event) => setStartsAt(event.target.value)}
            >
              <option value="">
                {slotsLoading
                  ? t("Loading available times…")
                  : t("Choose a time")}
              </option>
              {slots.map((slot) => (
                <option key={slot.startsAt} value={slot.startsAt}>
                  {timeForZone(slot.startsAt, bootstrap.timeZone, locale)}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            disabled={!startsAt || busy}
            onClick={() => void reschedule()}
          >
            {t("Save new time")}
          </Button>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <a
        className="text-sm underline underline-offset-4"
        href={bootstrap.publicUrl}
      >
        {t("Book another appointment")}
      </a>
    </main>
  );
}
