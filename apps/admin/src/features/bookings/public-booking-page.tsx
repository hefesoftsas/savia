import { useAppLocale, useMessages } from "@/i18n/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { loadCaptcha } from "../public-forms/public-form-submission";
import { mountAltcha } from "../public-forms/altcha-widget";
import { bookingMessages } from "./booking-messages";
import { publicBookingWizardMessages } from "./public-booking-wizard-messages";

type PublicCatalog = {
  id: string;
  title: string;
  description: string;
  timeZone: string;
  cancellationMinutes: number;
  services: Array<{
    id: string;
    name: string;
    description: string;
    durationMinutes: number;
    professionalIds: string[];
  }>;
  professionals: Array<{ id: string; name: string }>;
  captcha: {
    captchaProvider: "turnstile" | "altcha" | "disabled";
    siteKey?: string;
  };
};
type Slot = { startsAt: string; endsAt: string };
type Envelope<T> = { data: T };

function dateInZone(zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function slotLabel(startsAt: string, zone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(startsAt));
}

function dateLabel(date: string, locale: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "omit",
    headers: { Accept: "application/json", ...init?.headers },
  });
  const body = (await response.json()) as
    Envelope<T> | { error?: { message?: string } };
  if (!response.ok)
    throw Object.assign(
      new Error(
        body && "error" in body ? body.error?.message : "Request failed",
      ),
      { status: response.status },
    );
  return (body as Envelope<T>).data;
}

const createIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  `booking-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function PublicBookingPage({ token }: { token: string }) {
  const t = useMessages(bookingMessages);
  const wt = useMessages(publicBookingWizardMessages);
  const locale = useAppLocale();
  const captchaElement = useRef<HTMLDivElement>(null);
  const idempotency = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const [catalog, setCatalog] = useState<PublicCatalog>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const [slotsAttempt, setSlotsAttempt] = useState(0);
  const [step, setStep] = useState(1);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(step);
  const [busy, setBusy] = useState(false);
  const [reservation, setReservation] = useState<{
    startsAt: string;
    endsAt: string;
    managementUrl: string;
  }>();

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    stepHeadingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setCatalogError(false);
    void publicRequest<PublicCatalog>(
      `/api/public/bookings/${encodeURIComponent(token)}`,
    )
      .then((data) => {
        if (!active) return;
        setCatalog(data);
        setDate(dateInZone(data.timeZone));
        if (data.captcha.captchaProvider === "disabled")
          setCaptchaToken("local-bypass");
      })
      .catch(() => {
        if (active) {
          setCatalogError(true);
          setError(t("Booking settings could not be loaded."));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, t]);

  useEffect(() => {
    if (
      !catalog ||
      step !== 3 ||
      catalog.captcha.captchaProvider === "disabled" ||
      reservation
    )
      return;
    const activeCatalog = catalog;
    let active = true;
    let widget: { remove(): void } | undefined;
    const verified = (value: string) => {
      if (active) {
        setCaptchaToken(value);
        setCaptchaError("");
      }
    };
    const failed = () => {
      if (active) {
        setCaptchaToken("");
        setCaptchaError(
          t("Verification could not load. Check your connection and retry."),
        );
      }
    };
    async function mountCaptcha() {
      if (!captchaElement.current) return;
      if (activeCatalog.captcha.captchaProvider === "altcha") {
        const instance = await mountAltcha(
          captchaElement.current,
          `/api/public/bookings/${encodeURIComponent(token)}/challenge`,
          verified,
          (state) => {
            if (active && state !== "verified") setCaptchaToken("");
            if (state === "error") failed();
          },
          locale,
        );
        if (active) widget = instance;
        else instance.remove();
      } else {
        const api = await loadCaptcha();
        if (!active || !captchaElement.current) return;
        const id = api.render(captchaElement.current, {
          sitekey: activeCatalog.captcha.siteKey,
          action: "public_submit",
          cData: activeCatalog.id,
          language: locale,
          size: "flexible",
          callback: verified,
          "expired-callback": () => verified(""),
          "error-callback": failed,
        });
        widget = { remove: () => api.remove(id) };
      }
    }
    void mountCaptcha().catch(failed);
    return () => {
      active = false;
      widget?.remove();
    };
  }, [catalog, locale, token, reservation, captchaAttempt, step, t]);

  const selectedService = useMemo(
    () => catalog?.services.find((service) => service.id === serviceId),
    [catalog, serviceId],
  );
  const eligibleProfessionals = useMemo(
    () =>
      catalog?.professionals.filter((person) =>
        selectedService?.professionalIds.includes(person.id),
      ) ?? [],
    [catalog, selectedService],
  );

  useEffect(() => {
    if (
      !catalog ||
      step !== 2 ||
      !serviceId ||
      !professionalId ||
      !date ||
      reservation
    )
      return;
    let active = true;
    setSlotsLoading(true);
    setSlots([]);
    void publicRequest<{ slots: Slot[]; timeZone: string }>(
      `/api/public/bookings/${encodeURIComponent(token)}/slots?serviceId=${encodeURIComponent(serviceId)}&professionalId=${encodeURIComponent(professionalId)}&date=${encodeURIComponent(date)}`,
    )
      .then((data) => {
        if (!active) return;
        setSlots(data.slots);
        if (
          startsAt &&
          !data.slots.some((slot) => slot.startsAt === startsAt)
        ) {
          setStartsAt("");
          idempotency.current = undefined;
        }
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
  }, [
    catalog,
    token,
    serviceId,
    professionalId,
    date,
    step,
    reservation,
    slotsAttempt,
    t,
  ]);

  function changed() {
    idempotency.current = undefined;
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !catalog ||
      step !== 3 ||
      !serviceId ||
      !professionalId ||
      !startsAt ||
      !slots.some((slot) => slot.startsAt === startsAt) ||
      !captchaToken ||
      busy
    )
      return;
    const body = {
      serviceId,
      professionalId,
      startsAt,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      captchaToken,
    };
    const signature = JSON.stringify({
      serviceId,
      professionalId,
      startsAt,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
    });
    if (!idempotency.current || idempotency.current.signature !== signature)
      idempotency.current = { signature, key: createIdempotencyKey() };
    setBusy(true);
    setError("");
    try {
      const result = await publicRequest<{
        reservation: { startsAt: string; endsAt: string };
        managementUrl: string;
      }>(`/api/public/bookings/${encodeURIComponent(token)}/reservations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotency.current.key,
        },
        body: JSON.stringify(body),
      });
      setReservation({
        ...result.reservation,
        managementUrl: result.managementUrl,
      });
    } catch (requestError) {
      const status =
        requestError &&
        typeof requestError === "object" &&
        "status" in requestError
          ? requestError.status
          : undefined;
      if (status === 403 || status === 409) {
        if (catalog.captcha.captchaProvider !== "disabled") {
          setCaptchaToken("");
          setCaptchaAttempt((attempt) => attempt + 1);
        }
        if (status === 409) {
          setStartsAt("");
          setSlotsAttempt((attempt) => attempt + 1);
          setStep(2);
        }
      }
      setError(
        t("Your booking could not be confirmed. Retry with the same request."),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className="mx-auto grid max-w-2xl gap-4 px-4 py-10" role="status">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="h-28 animate-pulse rounded bg-muted" />
        <span className="sr-only">{t("Loading booking settings…")}</span>
      </main>
    );
  if (catalogError || !catalog)
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </main>
    );
  if (reservation)
    return (
      <main className="mx-auto grid max-w-2xl gap-5 px-4 py-10">
        <h1 className="text-2xl font-semibold">{t("Appointment confirmed")}</h1>
        <p>
          {slotLabel(reservation.startsAt, catalog.timeZone, locale)} ·{" "}
          {catalog.timeZone}
        </p>
        <a
          className="underline underline-offset-4"
          href={reservation.managementUrl}
        >
          {t("Manage or cancel this appointment")}
        </a>
        <p className="text-sm text-muted-foreground">
          {t("Cancellation cutoff (minutes)")}: {catalog.cancellationMinutes}
        </p>
      </main>
    );

  const disabledCaptcha = catalog.captcha.captchaProvider === "disabled";
  const hasAvailableSelection = slots.some(
    (slot) => slot.startsAt === startsAt,
  );
  const selectedProfessional = eligibleProfessionals.find(
    (person) => person.id === professionalId,
  );
  const selectedSlot = slots.find((slot) => slot.startsAt === startsAt);
  const stepNames = [
    wt("Service and professional"),
    wt("Date and time"),
    wt("Your details"),
  ];
  return (
    <main className="mx-auto grid max-w-xl gap-7 px-4 py-8 md:py-12">
      <header className="grid gap-3">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {catalog.title}
        </h1>
        <p className="max-w-prose whitespace-pre-wrap text-muted-foreground">
          {catalog.description}
        </p>
        <p className="text-sm text-muted-foreground">{catalog.timeZone}</p>
      </header>
      <nav aria-label={wt("Booking progress")}>
        <ol
          className="grid grid-cols-3 border-b"
          aria-label={wt("Booking progress")}
        >
          {stepNames.map((name, index) => {
            const number = index + 1;
            const current = step === number;
            const complete = step > number;
            return (
              <li
                key={name}
                aria-current={current ? "step" : undefined}
                className={`border-b-2 px-1 pb-3 text-xs leading-snug sm:text-sm ${
                  current
                    ? "border-primary font-medium text-foreground"
                    : complete
                      ? "border-primary/50 text-foreground"
                      : "border-transparent text-muted-foreground"
                }`}
              >
                <span className="mb-1 block text-xs tabular-nums">
                  {number} / 3
                </span>
                {name}
              </li>
            );
          })}
        </ol>
      </nav>
      <form className="grid gap-6" onSubmit={submit}>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="grid min-w-0 gap-6 border-0 p-0">
          {step === 1 && (
            <section
              aria-labelledby="booking-step-heading"
              className="grid gap-5"
            >
              <h2
                id="booking-step-heading"
                ref={stepHeadingRef}
                tabIndex={-1}
                className="text-lg font-semibold focus:outline-none"
              >
                {wt("Choose your appointment")}
              </h2>
              <label className="grid gap-2 text-sm font-medium">
                {t("Service")}
                <select
                  className="h-11 min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
                  required
                  value={serviceId}
                  onChange={(event) => {
                    changed();
                    setServiceId(event.target.value);
                    setProfessionalId("");
                    setSlots([]);
                    setStartsAt("");
                  }}
                >
                  <option value="">{t("Choose a service")}</option>
                  {catalog.services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} · {service.durationMinutes} min
                    </option>
                  ))}
                </select>
              </label>
              {selectedService && (
                <p className="-mt-2 text-sm text-muted-foreground">
                  {selectedService.description}
                </p>
              )}
              <label className="grid gap-2 text-sm font-medium">
                {t("Professional")}
                <select
                  className="h-11 min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                  required
                  disabled={!selectedService}
                  value={professionalId}
                  onChange={(event) => {
                    changed();
                    setProfessionalId(event.target.value);
                    setSlots([]);
                    setStartsAt("");
                  }}
                >
                  <option value="">{t("Choose a professional")}</option>
                  {eligibleProfessionals.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end border-t pt-5">
                <Button
                  type="button"
                  className="h-11 min-w-32"
                  disabled={!serviceId || !professionalId}
                  onClick={() => setStep(2)}
                >
                  {wt("Continue")}
                </Button>
              </div>
            </section>
          )}
          {step === 2 && (
            <section
              aria-labelledby="booking-step-heading"
              className="grid gap-5"
            >
              <h2
                id="booking-step-heading"
                ref={stepHeadingRef}
                tabIndex={-1}
                className="text-lg font-semibold focus:outline-none"
              >
                {wt("Date and time")}
              </h2>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  {t("Date")}
                  <Input
                    className="h-11"
                    type="date"
                    required
                    value={date}
                    onChange={(event) => {
                      changed();
                      setDate(event.target.value);
                      setStartsAt("");
                    }}
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  {t("Available time")}
                  <select
                    className="h-11 min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                    required
                    disabled={slotsLoading || slots.length === 0}
                    value={startsAt}
                    onChange={(event) => {
                      changed();
                      setStartsAt(event.target.value);
                    }}
                  >
                    <option value="">
                      {slotsLoading
                        ? t("Loading available times…")
                        : slots.length
                          ? t("Choose a time")
                          : t("No available times")}
                    </option>
                    {slots.map((slot) => (
                      <option key={slot.startsAt} value={slot.startsAt}>
                        {slotLabel(slot.startsAt, catalog.timeZone, locale)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {slotsLoading && (
                <p className="text-sm text-muted-foreground" role="status">
                  {t("Loading available times…")}
                </p>
              )}
              <div className="flex items-center justify-between border-t pt-5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-w-24"
                  onClick={() => setStep(1)}
                >
                  {wt("Back")}
                </Button>
                <Button
                  type="button"
                  className="h-11 min-w-32"
                  disabled={!date || !hasAvailableSelection || slotsLoading}
                  onClick={() => setStep(3)}
                >
                  {wt("Continue")}
                </Button>
              </div>
            </section>
          )}
          {step === 3 && (
            <section
              aria-labelledby="booking-step-heading"
              className="grid gap-5"
            >
              <div className="grid gap-1">
                <h2
                  id="booking-step-heading"
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="text-lg font-semibold focus:outline-none"
                >
                  {wt("Your details")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {wt("Review your appointment and add your contact details.")}
                </p>
              </div>
              <dl className="grid gap-3 border-y py-4 text-sm sm:grid-cols-3">
                <div className="grid gap-1">
                  <dt className="text-muted-foreground">
                    {wt("Selected service")}
                  </dt>
                  <dd className="font-medium">{selectedService?.name}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-muted-foreground">
                    {wt("Selected professional")}
                  </dt>
                  <dd className="font-medium">{selectedProfessional?.name}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-muted-foreground">
                    {wt("Selected date and time")}
                  </dt>
                  <dd className="font-medium">
                    {dateLabel(date, locale)} ·{" "}
                    {selectedSlot
                      ? slotLabel(startsAt, catalog.timeZone, locale)
                      : ""}
                  </dd>
                </div>
              </dl>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium sm:col-span-2">
                  {t("Your name")}
                  <Input
                    className="h-11 text-base"
                    required
                    autoComplete="name"
                    maxLength={200}
                    value={customerName}
                    onChange={(event) => {
                      changed();
                      setCustomerName(event.target.value);
                    }}
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium sm:col-span-2">
                  {t("Email")}
                  <Input
                    className="h-11 text-base"
                    required
                    type="email"
                    autoComplete="email"
                    maxLength={320}
                    value={customerEmail}
                    onChange={(event) => {
                      changed();
                      setCustomerEmail(event.target.value);
                    }}
                  />
                </label>
              </div>
              {!disabledCaptcha && (
                <div className="grid gap-1.5">
                  <div
                    ref={captchaElement}
                    aria-label="CAPTCHA"
                    className="min-h-16 max-w-full overflow-hidden"
                  />
                  {captchaError && (
                    <p role="alert" className="text-sm text-destructive">
                      {captchaError}
                    </p>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between border-t pt-5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-w-24"
                  onClick={() => setStep(2)}
                >
                  {wt("Back")}
                </Button>
                <Button
                  type="submit"
                  className="h-11 min-w-40"
                  disabled={busy || slotsLoading || !captchaToken}
                >
                  {busy
                    ? t("Loading booking settings…")
                    : error
                      ? t("Retry booking")
                      : t("Book appointment")}
                </Button>
              </div>
            </section>
          )}
        </fieldset>
      </form>
    </main>
  );
}
