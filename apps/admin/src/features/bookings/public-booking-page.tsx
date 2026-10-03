import { useAppLocale, useMessages } from "@/i18n/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { loadCaptcha } from "../public-forms/public-form-submission";
import { mountAltcha } from "../public-forms/altcha-widget";
import { bookingMessages } from "./booking-messages";

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
  const [busy, setBusy] = useState(false);
  const [reservation, setReservation] = useState<{
    startsAt: string;
    endsAt: string;
    managementUrl: string;
  }>();

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
  }, [catalog, locale, token, reservation, captchaAttempt, t]);

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
    if (!catalog || !serviceId || !professionalId || !date || reservation)
      return;
    let active = true;
    setSlotsLoading(true);
    setSlots([]);
    setStartsAt("");
    void publicRequest<{ slots: Slot[]; timeZone: string }>(
      `/api/public/bookings/${encodeURIComponent(token)}/slots?serviceId=${encodeURIComponent(serviceId)}&professionalId=${encodeURIComponent(professionalId)}&date=${encodeURIComponent(date)}`,
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
  }, [
    catalog,
    token,
    serviceId,
    professionalId,
    date,
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
      !serviceId ||
      !professionalId ||
      !startsAt ||
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
  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-8 md:py-12">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {catalog.title}
        </h1>
        <p className="whitespace-pre-wrap text-muted-foreground">
          {catalog.description}
        </p>
        <p className="text-sm">{catalog.timeZone}</p>
      </header>
      <form className="grid gap-4" onSubmit={submit}>
        <label className="grid gap-1.5 text-sm">
          {t("Service")}
          <select
            className="h-10 rounded-md border bg-background px-3"
            required
            value={serviceId}
            onChange={(event) => {
              changed();
              setServiceId(event.target.value);
              setProfessionalId("");
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
          <p className="text-sm text-muted-foreground">
            {selectedService.description}
          </p>
        )}
        <label className="grid gap-1.5 text-sm">
          {t("Professional")}
          <select
            className="h-10 rounded-md border bg-background px-3"
            required
            disabled={!selectedService}
            value={professionalId}
            onChange={(event) => {
              changed();
              setProfessionalId(event.target.value);
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
        <label className="grid gap-1.5 text-sm">
          {t("Date")}
          <Input
            type="date"
            required
            value={date}
            onChange={(event) => {
              changed();
              setDate(event.target.value);
            }}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          {t("Available time")}
          <select
            className="h-10 rounded-md border bg-background px-3"
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
        <label className="grid gap-1.5 text-sm">
          {t("Your name")}
          <Input
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
        <label className="grid gap-1.5 text-sm">
          {t("Email")}
          <Input
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
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || slotsLoading || !captchaToken}>
          {busy
            ? t("Loading booking settings…")
            : error
              ? t("Retry booking")
              : t("Book appointment")}
        </Button>
      </form>
    </main>
  );
}
