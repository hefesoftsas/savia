import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { intlLocale, useAppLocale, useMessages } from "@/i18n/core";
import QRCode from "react-qr-code";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bookingMessages } from "./booking-messages";
import type { BookingLinkScope, BookingPublicLink } from "./booking-types";

type ServiceOption = { id: string; name: string };
type Expiry = "24h" | "7d" | "30d" | "never";

function expiryDate(expiry: Expiry) {
  if (expiry === "never") return null;
  const hours = expiry === "24h" ? 24 : expiry === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function linkIsActive(link: BookingPublicLink) {
  return (
    !link.revokedAt &&
    !(link.expiresAt && Date.parse(link.expiresAt) <= Date.now())
  );
}

export function BookingPublicLinksPanel({
  tenantId,
  currentProfessionalId,
  currentProfessionalName,
  canManageTeamLinks,
  apiClient,
  services,
}: {
  tenantId: string;
  currentProfessionalId: string | null;
  currentProfessionalName?: string;
  canManageTeamLinks: boolean;
  apiClient: ApiClient;
  services: ServiceOption[];
}) {
  const t = useMessages(bookingMessages);
  const locale = useAppLocale();
  const [links, setLinks] = useState<BookingPublicLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("30d");
  const [serviceId, setServiceId] = useState("");
  const [dailyLimit, setDailyLimit] = useState(25);
  const [busy, setBusy] = useState(false);
  const [activeOperation, setActiveOperation] = useState("");

  const endpoint = `/v1/tenants/${encodeURIComponent(tenantId)}/booking/public-links`;
  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await apiClient.get<{
        data: { links: BookingPublicLink[] };
      }>(endpoint);
      setLinks(response.data.links);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [apiClient, endpoint]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  const activeLinks = useMemo(() => links.filter(linkIsActive), [links]);
  const expiryLabel = (link: BookingPublicLink) =>
    link.expiresAt
      ? t("Expires %{date}", {
          date: new Intl.DateTimeFormat(intlLocale(locale), {
            dateStyle: "medium",
          }).format(new Date(link.expiresAt)),
        })
      : t("No expiry");

  async function create(scope: BookingLinkScope) {
    setBusy(true);
    setError(false);
    setNotice("");
    try {
      const response = await apiClient.post<{ data: BookingPublicLink }>(
        endpoint,
        {
          scope,
          serviceId: serviceId || null,
          expiresAt: expiryDate(expiry),
          dailyLimit,
        },
      );
      setLinks((current) => [
        response.data,
        ...current.filter((link) => link.id !== response.data.id),
      ]);
      setNotice(t("Booking link created."));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(link: BookingPublicLink) {
    setActiveOperation(link.id);
    setError(false);
    setNotice("");
    try {
      const response = await apiClient.post<{ data: BookingPublicLink }>(
        `${endpoint}/${encodeURIComponent(link.id)}/revoke`,
        { version: link.version },
      );
      setLinks((current) =>
        current.map((item) => (item.id === link.id ? response.data : item)),
      );
      setNotice(t("Booking link revoked."));
    } catch {
      setError(true);
    } finally {
      setActiveOperation("");
    }
  }

  async function copy(link: BookingPublicLink) {
    try {
      await navigator.clipboard.writeText(link.publicUrl);
      setNotice(t("Link copied."));
    } catch {
      setError(true);
    }
  }

  async function share(link: BookingPublicLink) {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: t("Appointments"), url: link.publicUrl });
      setNotice(t("Booking link shared."));
    } catch (shareError) {
      if (!(
        shareError instanceof DOMException && shareError.name === "AbortError"
      ))
        setError(true);
    }
  }

  const scopeName = (scope: BookingLinkScope) =>
    scope.kind === "team" ? t("Team agenda") : t("My booking link");

  return (
    <section
      aria-labelledby="booking-links-heading"
      className="grid gap-5 border-t pt-6"
    >
      <div className="grid gap-1">
        <h2 id="booking-links-heading" className="text-lg font-semibold">
          {t("Booking links")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("Create and manage links customers can use to book appointments.")}
        </p>
      </div>
      <div className="grid gap-4 rounded-lg border bg-card p-4">
        {currentProfessionalId && currentProfessionalName && (
          <p className="text-sm text-muted-foreground">
            {t("Personal link for %{name}", { name: currentProfessionalName })}
          </p>
        )}
        <label className="grid gap-2 text-sm font-medium">
          {t("Link expiry")}
          <select
            className="h-11 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value as Expiry)}
          >
            <option value="24h">{t("24 hours")}</option>
            <option value="7d">{t("7 days")}</option>
            <option value="30d">{t("30 days (default)")}</option>
            <option value="never">{t("No expiry")}</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          {t("Service (optional)")}
          <select
            className="h-11 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          >
            <option value="">{t("Any eligible service")}</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          {t("Daily booking limit")}
          <input
            aria-label={t("Daily booking limit")}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            type="number"
            min={1}
            max={1000}
            step={1}
            required
            value={dailyLimit}
            onChange={(event) =>
              setDailyLimit(
                Math.min(1000, Math.max(1, Number(event.target.value) || 1)),
              )
            }
          />
        </label>
        <p className="text-sm text-muted-foreground">
          {t(
            "New links default to 25 bookings per day. Set a link-specific limit below.",
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-h-11"
            disabled={busy || !currentProfessionalId}
            onClick={() =>
              currentProfessionalId &&
              void create({
                kind: "professional",
                professionalId: currentProfessionalId,
              })
            }
          >
            {t("Create my booking link")}
          </Button>
          {canManageTeamLinks && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => void create({ kind: "team" })}
            >
              {t("Create team agenda link")}
            </Button>
          )}
        </div>
        {!currentProfessionalId && (
          <p role="status" className="text-sm text-muted-foreground">
            {t(
              "Your booking profile is not set up yet. Ask an administrator to add you as an active professional before creating a personal link.",
            )}
          </p>
        )}
        {!canManageTeamLinks && (
          <p className="text-sm text-muted-foreground">
            {t("Team booking links are available to booking administrators.")}
          </p>
        )}
      </div>
      {notice && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(
            "Booking links could not be updated. Check your connection and retry.",
          )}
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("Loading booking links…")}
        </p>
      )}
      {!loading && !error && !links.length && (
        <p className="text-sm text-muted-foreground">
          {t("No booking links yet. Create a personal link to get started.")}
        </p>
      )}
      {!!links.length && (
        <ul className="grid gap-4">
          {links.map((link) => {
            const active = linkIsActive(link);
            const service = services.find((item) => item.id === link.serviceId);
            return (
              <li
                key={link.id}
                className="grid min-w-0 gap-3 border-b pb-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="grid min-w-0 gap-1">
                  <h3 className="font-medium">
                    {scopeName(link.scope)}
                    {service ? ` · ${service.name}` : ""}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {expiryLabel(link)} ·{" "}
                    {t("%{count} bookings per day", { count: link.dailyLimit })}
                  </p>
                  <a
                    className="w-fit max-w-full break-all text-sm underline underline-offset-4"
                    href={link.publicUrl}
                  >
                    {link.publicUrl}
                  </a>
                  {!active && (
                    <p className="text-sm text-muted-foreground">
                      {link.revokedAt ? t("Revoked") : t("Expired")}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {active && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        onClick={() => void copy(link)}
                      >
                        {t("Copy link")}
                      </Button>
                      {typeof navigator !== "undefined" &&
                        "share" in navigator && (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11"
                            onClick={() => void share(link)}
                          >
                            {t("Share")}
                          </Button>
                        )}
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        disabled={activeOperation === link.id}
                        onClick={() => void revoke(link)}
                      >
                        {activeOperation === link.id
                          ? t("Revoking…")
                          : t("Revoke link")}
                      </Button>
                    </>
                  )}
                  <details className="w-full sm:w-auto">
                    <summary className="flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm font-medium">
                      {t("QR code")}
                    </summary>
                    <div className="mt-2 w-fit rounded-md border bg-white p-3">
                      <QRCode
                        value={link.publicUrl}
                        size={144}
                        title={t("QR code for %{name}", {
                          name: scopeName(link.scope),
                        })}
                      />
                    </div>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!!activeLinks.length && (
        <p className="text-xs text-muted-foreground">
          {t(
            "Revoking a booking link does not affect confirmed appointments or their private management links.",
          )}
        </p>
      )}
    </section>
  );
}
