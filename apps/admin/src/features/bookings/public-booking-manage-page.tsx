import { Button } from "@/components/ui/button";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { bookingMessages } from "./booking-messages";
import { PublicBookingAvailability } from "./public-booking-availability";
import { PublicBookingSummary } from "./public-booking-summary";
import type { BookingSelection } from "./booking-types";
import {
  BookingConference,
  type BookingConferenceState,
} from "./booking-conference";

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
  conference?: BookingConferenceState;
};
type ManageBootstrap = {
  reservation: Reservation;
  publicUrl: string | null;
  timeZone: string;
  cancellationMinutes: number;
  horizonDays: number;
  leadMinutes: number;
  canReschedule: boolean;
};
type ApiError = Error & { status?: number };

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
  if (!response.ok) {
    const error = new Error(
      value.error?.message ?? "Request failed",
    ) as ApiError;
    error.status = response.status;
    throw error;
  }
  return value.data as T;
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
  const managePath = `/api/public/bookings/manage/${encodeURIComponent(token)}`;
  const [bootstrap, setBootstrap] = useState<ManageBootstrap>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [conferenceRefreshError, setConferenceRefreshError] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [selection, setSelection] = useState<BookingSelection>();
  const [displayTimeZone, setDisplayTimeZone] = useState("");
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [availabilityRefreshKey, setAvailabilityRefreshKey] = useState(0);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const refreshSequence = useRef(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void publicRequest<ManageBootstrap>(managePath)
      .then((data) => {
        if (active) {
          setBootstrap(data);
          setDisplayTimeZone(data.timeZone);
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
  }, [managePath, t]);

  useEffect(() => {
    if (rescheduling) stepHeading.current?.focus();
  }, [rescheduling, reviewing]);

  const reservation = bootstrap?.reservation;
  function updateBootstrap(next: ManageBootstrap) {
    setBootstrap((current) => {
      if (!current) return next;
      if (
        next.reservation.version < current.reservation.version ||
        (current.reservation.status === "cancelled" &&
          next.reservation.status !== "cancelled")
      )
        return current;
      return next;
    });
  }
  function updateReservation(nextReservation: Reservation) {
    setBootstrap((current) => {
      if (!current) return current;
      if (
        nextReservation.version < current.reservation.version ||
        (current.reservation.status === "cancelled" &&
          nextReservation.status !== "cancelled")
      )
        return current;
      return { ...current, reservation: nextReservation };
    });
  }
  function invalidateRefresh() {
    refreshSequence.current += 1;
    setRefreshing(false);
  }
  async function refreshAppointment() {
    const request = ++refreshSequence.current;
    setRefreshing(true);
    setConferenceRefreshError("");
    try {
      const data = await publicRequest<ManageBootstrap>(managePath);
      if (request === refreshSequence.current) updateBootstrap(data);
    } catch {
      if (request === refreshSequence.current)
        setConferenceRefreshError(
          t("The appointment could not be refreshed. Try again."),
        );
    } finally {
      if (request === refreshSequence.current) setRefreshing(false);
    }
  }
  const summaryCatalog = useMemo(
    () =>
      bootstrap
        ? {
            timeZone: bootstrap.timeZone,
            services: [
              {
                id: bootstrap.reservation.serviceId,
                name: bootstrap.reservation.serviceName,
                durationMinutes: Math.round(
                  (Date.parse(bootstrap.reservation.endsAt) -
                    Date.parse(bootstrap.reservation.startsAt)) /
                    60000,
                ),
              },
            ],
            professionals: [
              {
                id: bootstrap.reservation.professionalId,
                name: bootstrap.reservation.professionalName,
              },
            ],
          }
        : undefined,
    [bootstrap],
  );

  async function cancel() {
    if (!bootstrap) return;
    invalidateRefresh();
    setBusy(true);
    setError("");
    try {
      const nextReservation = await publicRequest<Reservation>(
        `${managePath}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: bootstrap.reservation.version }),
        },
      );
      updateReservation(nextReservation);
      setUpdated(false);
    } catch {
      setError(
        t("This booking could not be cancelled. Refresh the page and retry."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!bootstrap || !selection) return;
    const submittedStartsAt = selection.slot.startsAt;
    invalidateRefresh();
    setBusy(true);
    setError("");
    try {
      const nextReservation = await publicRequest<Reservation>(
        `${managePath}/reschedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: bootstrap.reservation.version,
            startsAt: submittedStartsAt,
          }),
        },
      );
      updateReservation(nextReservation);
      setRescheduling(false);
      setReviewing(false);
      setUpdated(true);
    } catch (requestError) {
      if ([404, 409].includes((requestError as ApiError)?.status ?? 0)) {
        try {
          const current = await publicRequest<ManageBootstrap>(managePath);
          updateBootstrap(current);
          setDisplayTimeZone(selection.displayTimeZone);
          setReviewing(false);
          if (
            current.reservation.status === "confirmed" &&
            current.reservation.startsAt === submittedStartsAt
          ) {
            setUpdated(true);
            setRescheduling(false);
          } else {
            setSelection(undefined);
            const canContinueRescheduling =
              current.reservation.status === "confirmed" &&
              current.canReschedule &&
              Date.parse(current.reservation.startsAt) - Date.now() >=
                current.cancellationMinutes * 60000;
            if (canContinueRescheduling) {
              setAvailabilityRefreshKey((key) => key + 1);
              setError(
                t(
                  "That time is no longer available. Choose another available time.",
                ),
              );
            } else {
              setRescheduling(false);
              setError(
                t("To change this appointment, contact the booking business."),
              );
            }
          }
        } catch {
          setError(
            t(
              "This booking could not be rescheduled. Refresh the times and retry.",
            ),
          );
        }
      } else {
        setError(
          t(
            "This booking could not be rescheduled. Refresh the times and retry.",
          ),
        );
      }
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
  if (!bootstrap || !reservation)
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </main>
    );

  const canChange =
    Date.parse(reservation.startsAt) - Date.now() >=
    bootstrap.cancellationMinutes * 60000;
  const bookingCatalog = {
    id: reservation.id,
    timeZone: bootstrap.timeZone,
    horizonDays: bootstrap.horizonDays,
    leadMinutes: bootstrap.leadMinutes,
  };

  return (
    <main className="mx-auto grid max-w-3xl gap-5 px-4 py-8 md:py-12">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold">
          {t("Manage or cancel this appointment")}
        </h1>
        <p>
          {reservation.serviceName} · {reservation.professionalName}
        </p>
        <p>
          {timeForZone(
            reservation.startsAt,
            bootstrap.timeZone,
            intlLocale(locale),
          )}{" "}
          · {bootstrap.timeZone}
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
      <BookingConference
        conference={reservation.conference}
        status={reservation.status}
      />
      {reservation.status === "confirmed" &&
        reservation.conference?.status === "pending" && (
          <Button
            type="button"
            variant="outline"
            disabled={refreshing || busy}
            onClick={() => void refreshAppointment()}
          >
            {refreshing
              ? t("Refreshing appointment…")
              : t("Refresh appointment")}
          </Button>
        )}
      {conferenceRefreshError && (
        <p role="alert" className="text-sm text-destructive">
          {conferenceRefreshError}
        </p>
      )}
      {updated && summaryCatalog && selection && (
        <section className="grid gap-2" aria-live="polite">
          <h2 className="text-lg font-semibold">{t("Updated appointment")}</h2>
          <p role="status">{t("Your appointment has been updated.")}</p>
          <PublicBookingSummary
            catalog={summaryCatalog}
            selection={selection}
          />
        </section>
      )}
      {reservation.status === "confirmed" && (
        <div className="flex flex-wrap gap-2">
          {!rescheduling && bootstrap.canReschedule && canChange && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSelection(undefined);
                setDisplayTimeZone(bootstrap.timeZone);
                setError("");
                setUpdated(false);
                setReviewing(false);
                setRescheduling(true);
              }}
            >
              {t("Reschedule")}
            </Button>
          )}
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
      {reservation.status === "confirmed" &&
        !bootstrap.canReschedule &&
        error !==
          t("To change this appointment, contact the booking business.") && (
          <p className="text-sm text-muted-foreground">
            {t("To change this appointment, contact the booking business.")}
          </p>
        )}
      {rescheduling && reservation.status === "confirmed" && (
        <section className="grid gap-4" aria-live="polite">
          {!reviewing && (
            <>
              <h2
                id="booking-step-heading"
                ref={stepHeading}
                tabIndex={-1}
                className="text-lg font-semibold focus:outline-none"
              >
                {t("Choose a new time")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("Current appointment")}:{" "}
                {timeForZone(
                  reservation.startsAt,
                  displayTimeZone,
                  intlLocale(locale),
                )}
              </p>
              <PublicBookingAvailability
                token={token}
                mode="management"
                catalog={bookingCatalog}
                serviceId={reservation.serviceId}
                professionalId={reservation.professionalId}
                displayTimeZone={displayTimeZone}
                onTimeZoneChange={setDisplayTimeZone}
                value={selection}
                onChange={setSelection}
                onLoadingChange={setSlotsLoading}
                refreshKey={availabilityRefreshKey}
                hideHeading
                excludedStartsAt={[reservation.startsAt]}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRescheduling(false);
                    setSelection(undefined);
                    setError("");
                  }}
                >
                  {t("Stop rescheduling")}
                </Button>
                <Button
                  type="button"
                  disabled={
                    !selection ||
                    selection.slot.startsAt === reservation.startsAt ||
                    slotsLoading ||
                    busy
                  }
                  onClick={() => setReviewing(true)}
                >
                  {t("Continue")}
                </Button>
              </div>
            </>
          )}
          {reviewing && summaryCatalog && (
            <>
              <h2
                id="booking-step-heading"
                ref={stepHeading}
                tabIndex={-1}
                className="text-lg font-semibold focus:outline-none"
              >
                {t("Review your change")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("Current appointment")}:{" "}
                {timeForZone(
                  reservation.startsAt,
                  displayTimeZone,
                  intlLocale(locale),
                )}
              </p>
              <PublicBookingSummary
                catalog={summaryCatalog}
                selection={selection}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setReviewing(false)}
                >
                  {t("Back")}
                </Button>
                <Button
                  type="button"
                  disabled={busy || !selection}
                  onClick={() => void reschedule()}
                >
                  {busy ? t("Saving…") : t("Confirm reschedule")}
                </Button>
              </div>
            </>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {bootstrap.publicUrl && (
        <a
          className="text-sm underline underline-offset-4"
          href={bootstrap.publicUrl}
        >
          {t("Book another appointment")}
        </a>
      )}
    </main>
  );
}
